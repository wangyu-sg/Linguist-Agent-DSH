"""Local source-text retrieval. No memories, cloud calls, QA findings or target writes."""
import asyncio
import hashlib
import importlib.metadata
import itertools
import json
import os
from pathlib import Path
import sqlite3
import sys

MODEL = "gpahal/bge-m3-onnx-int8"
MIN_SIMILARITY = 0.72
NEIGHBORS = 5
PIPELINE = "source-neighbors-v1"


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False).encode()).hexdigest()


def model_identity():
    from huggingface_hub import hf_hub_download
    files = []
    for name in ("tokenizer.json", "model_quantized.onnx"):
        path = Path(hf_hub_download(MODEL, name, local_files_only=True)).resolve()
        stat = path.stat()
        files.append((str(path), stat.st_size, stat.st_mtime_ns))
    return digest([MODEL, importlib.metadata.version("memsearch"), PIPELINE, files])


async def embed_sources(texts):
    import numpy as np
    import onnxruntime as ort
    from huggingface_hub import hf_hub_download
    from memsearch.embeddings.onnx import OnnxEmbedding
    from tokenizers import Tokenizer
    ort.disable_telemetry_events()
    model = OnnxEmbedding(model=MODEL, batch_size=8)
    # Cover long strings in full instead of silently truncating them at 8192 tokens.
    tokenizer = Tokenizer.from_file(hf_hub_download(MODEL, 'tokenizer.json', local_files_only=True))
    tokenizer.no_truncation()
    vectors = []
    pending, owners = [], []
    sums = [np.zeros(model.dimension, dtype=np.float32) for _ in texts]

    async def flush():
        if pending:
            for owner, vector in zip(owners, await model.embed(pending), strict=True):
                sums[owner] += np.asarray(vector, dtype=np.float32)
            pending.clear()
            owners.clear()

    for owner, text in enumerate(texts):
        offsets = tokenizer.encode(text, add_special_tokens=False).offsets
        ends = [offsets[min(start + 512, len(offsets)) - 1][1] for start in range(0, len(offsets), 512)]
        ends = sorted(set([*ends, len(text)]))
        start = 0
        for end in ends:
            if end > start:
                pending.append(text[start:end])
                owners.append(owner)
                if len(pending) == model.batch_size:
                    await flush()
            start = end
    await flush()
    for vector in sums:
        norm = np.linalg.norm(vector)
        if not np.isfinite(norm) or norm == 0:
            raise ValueError("Local embedding returned an invalid vector")
        vectors.append(vector / norm)
    return vectors


def related_groups(vectors):
    import numpy as np
    matrix = np.asarray(vectors, dtype=np.float32)
    neighbors = []
    # Exact blocked search: no extra vector database and no full N-by-N matrix.
    for start in range(0, len(matrix), 128):
        scores = matrix[start:start + 128] @ matrix.T
        for offset, row in enumerate(scores):
            anchor = start + offset
            row[anchor] = -1
            matches = np.flatnonzero(row >= MIN_SIMILARITY)
            ranked = sorted(matches.tolist(), key=lambda i: (-float(row[i]), i))[:NEIGHBORS]
            neighbors.append((anchor, ranked))
    groups, covered = [], set()
    for anchor, matches in sorted(neighbors, key=lambda item: (-len(item[1]), item[0])):
        if not matches or all(tuple(sorted((anchor, i))) in covered for i in matches):
            continue
        members = [anchor, *matches]
        groups.append({"anchor": anchor, "members": members})
        covered.update(itertools.combinations(sorted(members), 2))
    return groups


async def retrieve(request):
    import numpy as np
    texts = sorted(set(text for text in request["texts"] if text.strip()))
    identity = model_identity()
    keys = [digest([identity, text]) for text in texts]
    scope = digest([identity, MIN_SIMILARITY, NEIGHBORS, keys])
    path = Path(request["cachePath"])
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path, timeout=300) as db:
        db.execute("CREATE TABLE IF NOT EXISTS vectors (key TEXT PRIMARY KEY, value BLOB NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS groups (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        # Concurrent roles share one computation, including the initial cold cache.
        db.execute("BEGIN IMMEDIATE")
        cached = db.execute("SELECT value FROM groups WHERE key = ?", (scope,)).fetchone()
        if cached:
            groups = json.loads(cached[0])
            embedded = 0
        else:
            rows = [db.execute("SELECT value FROM vectors WHERE key = ?", (key,)).fetchone() for key in keys]
            missing = [i for i, row in enumerate(rows) if row is None]
            fresh = await embed_sources([texts[i] for i in missing]) if missing else []
            for i, vector in zip(missing, fresh, strict=True):
                blob = vector.astype("<f4").tobytes()
                db.execute("INSERT INTO vectors VALUES (?, ?)", (keys[i], blob))
                rows[i] = (blob,)
            vectors = [np.frombuffer(row[0], dtype="<f4") for row in rows]
            groups = related_groups(vectors) if len(vectors) > 1 else []
            db.execute("INSERT INTO groups VALUES (?, ?)", (scope, json.dumps(groups)))
            embedded = len(missing)
    return {"model": MODEL, "fingerprint": identity, "texts": texts, "groups": groups,
            "embedded": embedded, "cached": len(texts) - embedded, "reusedGroups": bool(cached)}


if __name__ == "__main__":
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.umask(0o077)
    request = json.load(sys.stdin)
    result = {"model": MODEL, "fingerprint": model_identity()} if request.get("action") == "status" else asyncio.run(retrieve(request))
    print(json.dumps(result, ensure_ascii=False))
