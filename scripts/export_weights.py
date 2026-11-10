"""
Export the trained PyTorch value network to JSON so the browser can run it.

Reads a checkpoint saved with torch.save({'model_state_dict': ...}) and writes
src/ai/value-net.json. It parses the checkpoint's zip format directly, so PyTorch
doesn't need to be installed.

Usage:
    python scripts/export_weights.py path/to/value_model.pt
"""
import collections
import json
import pickle
import struct
import sys
import zipfile
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "src" / "ai" / "value-net.json"


def load_state_dict(path: str) -> dict:
    archive = zipfile.ZipFile(path)
    root = archive.namelist()[0].split("/")[0]

    class StorageRef:
        def __init__(self, key: str):
            self.key = key

    class Unpickler(pickle.Unpickler):
        def find_class(self, module, name):
            if name == "_rebuild_tensor_v2":
                def rebuild(storage, offset, size, stride, *_):
                    raw = archive.read(f"{root}/data/{storage.key}")
                    values = struct.unpack(f"<{len(raw) // 4}f", raw)  # float32, little-endian
                    total = 1
                    for dim in size:
                        total *= dim
                    return {"shape": list(size), "data": list(values[offset:offset + total])}
                return rebuild
            if module == "collections" and name == "OrderedDict":
                return collections.OrderedDict
            if module.startswith("torch") and name.endswith("Storage"):
                return name
            return super().find_class(module, name)

        def persistent_load(self, pid):
            # pid = ('storage', storage_type, key, location, numel)
            return StorageRef(pid[2])

    checkpoint = Unpickler(archive.open(f"{root}/data.pkl")).load()
    return checkpoint["model_state_dict"]


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    state = load_state_dict(sys.argv[1])
    compact = {
        name: {"shape": t["shape"], "data": [float(f"{x:.6g}") for x in t["data"]]}
        for name, t in state.items()
    }
    OUT.write_text(json.dumps(compact, separators=(",", ":")))
    for name, t in compact.items():
        print(f"{name:20} {t['shape']}")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
