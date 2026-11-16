"""Optional offline checks: run with the installed MemSearch ONNX Python environment."""
import importlib.util
import os
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
            vectors = await semantic.embed_sources([text])
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
