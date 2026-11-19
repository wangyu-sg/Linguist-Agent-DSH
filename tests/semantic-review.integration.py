"""Optional offline checks: run with the installed MemSearch ONNX Python environment."""
from contextlib import closing
import importlib.util
import os
import sqlite3
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
spec = importlib.util.spec_from_file_location('semantic', Path(__file__).resolve().parents[1] / 'packages/linguist-domain-service/src/semantic-review.py')
semantic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(semantic)


class SemanticReviewTest(unittest.IsolatedAsyncioTestCase):
    async def test_real_model_cache_increment_and_version(self):
        texts = ['请把三只纸鹤放在窗台上。', '将三只折纸鹤摆到窗台。',
                 '请把四只纸鹤放在窗台上。', '调低厨房吊灯的亮度。',
                 '每周清洗一次蓝色茶壶。', '蓝色茶壶需要每星期清洗一次。']
        with tempfile.TemporaryDirectory() as root:
            request = {'cachePath': str(Path(root) / 'cache.sqlite'), 'texts': texts}
            first = await semantic.retrieve(request)
            self.assertEqual(first['embedded'], len(texts))
            self.assertTrue(any(texts[0] in [first['texts'][i] for i in group['members']]
                                and texts[1] in [first['texts'][i] for i in group['members']] for group in first['groups']))
            with patch.object(semantic, 'embed_sources', side_effect=AssertionError('unchanged text was re-embedded')):
                grouped = await semantic.retrieve({**request, 'taskGroupId': 'group-a'})
                other = await semantic.retrieve({**request, 'taskGroupId': 'group-b'})
                self.assertFalse(grouped['reusedGroups'])
                self.assertFalse(other['reusedGroups'])
                self.assertEqual(other['embedded'], 0)
                self.assertTrue((await semantic.retrieve({**request, 'taskGroupId': 'group-a'}))['reusedGroups'])
                again = await semantic.retrieve({**request, 'texts': list(reversed(texts))})
                self.assertEqual(again['embedded'], 0)
                self.assertTrue(again['reusedGroups'])
                self.assertEqual(first['groups'], again['groups'])
            changed = await semantic.retrieve({**request, 'texts': texts[:-1] + ['打开客厅的台灯。']})
            self.assertEqual(changed['embedded'], 1)
            self.assertEqual(changed['cached'], len(texts) - 1)
            with patch.object(semantic, 'model_identity', return_value='synthetic-new-model-revision'):
                updated = await semantic.retrieve(request)
                self.assertEqual(updated['embedded'], len(texts))

    async def test_interrupted_material_index_resumes_without_publishing_partial_matches(self):
        from memsearch.embeddings.onnx import OnnxEmbedding
        encoded = []
        interrupt = True
        class Encoder(OnnxEmbedding):
            def __init__(self, **kwargs):
                self._dimension, self._batch_size = 2, 8
            async def embed(self, batch):
                if interrupt and len(encoded) == 96:
                    raise InterruptedError('synthetic interruption')
                encoded.extend(batch)
                return [[1, 0] for _ in batch]

        with tempfile.TemporaryDirectory() as root, patch('memsearch.embeddings.onnx.OnnxEmbedding', Encoder):
            path = Path(root) / 'cache.sqlite'
            request = {'cachePath': str(path), 'texts': [f'合成条目{i:04}' for i in range(120)], 'queries': ['查词']}
            states = []
            def record(phase, ready, total):
                states.append((phase, ready, total))
            with self.assertRaises(InterruptedError):
                await semantic.retrieve(request, report=record)
            self.assertEqual(states, [('preparing', i, 120) for i in (0, 32, 64, 96)])
            with closing(sqlite3.connect(path)) as db:
                saved, = db.execute('SELECT count(*) FROM vectors').fetchone()
                self.assertGreater(saved, 0)
                self.assertEqual(db.execute('SELECT count(*) FROM groups').fetchone()[0], 0)
            interrupt = False
            encoded.clear()
            states.clear()
            result = await semantic.retrieve(request, report=record)
            self.assertEqual(states, [('preparing', 96, 120), ('preparing', 120, 120), ('matching', 120, 120)])
            self.assertEqual(len(encoded), 121 - saved)
            self.assertEqual(result['cached'], saved)
            self.assertEqual(len(result['groups']), 1)
            self.assertNotIn('texts', result, 'material search only returns match positions to the host')

    async def test_background_preparation_is_reused_for_real_queries(self):
        with tempfile.TemporaryDirectory() as root:
            request = {'cachePath': str(Path(root) / 'cache.sqlite'),
                       'texts': ['请把三只纸鹤放在窗台上。', '调低厨房吊灯的亮度。']}
            with patch.object(semantic, 'related_groups', side_effect=AssertionError('preparation should only build vectors')):
                prepared = await semantic.retrieve({**request, 'queries': []})
                self.assertEqual(prepared['embedded'], 2)
                self.assertEqual(prepared['groups'], [])
                searched = await semantic.retrieve({**request, 'queries': ['将三只折纸鹤摆到窗台。']})
                self.assertEqual(searched['embedded'], 1)  # Only the new question.
                self.assertEqual(searched['groups'][0][0], 0)

    async def test_long_source_is_not_truncated(self):
        import numpy as np
        from types import SimpleNamespace
        captured = []

        class FakeEmbedding:
            dimension = 2
            batch_size = 8
            def __init__(self, **_kwargs):
                pass
            async def embed(self, texts):
                captured.extend(texts)
                return [[1, 0] for _ in texts]

        text = '合成的长文测试。' * 1200 + '结尾的重要条件。'
        tokenizer = SimpleNamespace(no_truncation=lambda: None,
            encode=lambda text, **kwargs: SimpleNamespace(offsets=[(i, i + 1) for i in range(len(text))]))
        with patch('memsearch.embeddings.onnx.OnnxEmbedding', FakeEmbedding), patch('tokenizers.Tokenizer.from_file', return_value=tokenizer):
            vectors = await semantic.embed_sources([text], *semantic.load_encoder())
        self.assertEqual(''.join(captured), text)
        self.assertLessEqual(max(map(len, captured)), 512)
        self.assertTrue(np.allclose(vectors, [[1, 0]]))

    def test_similarity_is_not_transitively_merged(self):
        import numpy as np
        vectors = [np.array([np.cos(angle), np.sin(angle)], dtype=np.float32)
                   for angle in np.deg2rad([0, 30, 60, 90])]
        groups = semantic.related_groups(vectors)
        self.assertGreater(len(groups), 1)
        for group in groups:
            for member in group['members']:
                self.assertGreaterEqual(float(vectors[group['anchor']] @ vectors[member]), semantic.MIN_SIMILARITY)


if __name__ == '__main__':
    unittest.main()
