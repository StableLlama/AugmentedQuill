# JSON Schemas

This directory contains JSON Schema files for validating configuration and project files in AugmentedQuill.

## Files

- `story-v2.schema.json`: Schema for `story.json` files in project directories, with metadata.version = 2.
- `projects.schema.json`: Schema for `config/projects.json`.
- `machine.schema.json`: Schema for `config/machine.json`.

## Usage

Use a JSON Schema validator to check the validity of the files against these schemas.

For example, using `jsonschema` in Python:

```python
import json
import jsonschema

with open('story.json', 'r') as f:
    data = json.load(f)

with open('schemas/story-v1.schema.json', 'r') as f:
    schema = json.load(f)

jsonschema.validate(data, schema)
```

## Versioning

The `metadata.version` field in `story.json` indicates the schema version to use for validation. Currently, version 2 is supported.
