# Legacy model migration audit

`legacy_model_audit.py` is an independent, standard-library-only transcription
of the geometry formerly assembled by `VehicleModel` and `TrainUnitModel`. It
pins the six built-in model IDs, ordered part IDs, materials, positions, scales,
zero local rotations, interaction dimensions, and display timing.

From the plugin directory (the path may contain spaces or Unicode):

```sh
python3 tools/legacy_model_audit.py
```

The command scans `src/main/resources/models/` and prints the file, model, part
index/ID, field, expected value, and actual value for every mismatch. Numeric
values are compared with a small tolerance to allow normal Java-float/YAML
decimal spelling differences.

To inspect or archive the canonical migration data without changing any YAML:

```sh
python3 tools/legacy_model_audit.py \
  --write tools/legacy-models.audit.json \
  --no-validate
```

`--write` accepts only a `.json` destination. The tool never writes model YAML.
Run `python3 tools/legacy_model_audit.py --help` for path and tolerance options.
