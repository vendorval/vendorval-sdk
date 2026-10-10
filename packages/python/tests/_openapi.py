"""Minimal OpenAPI request checker for the contract tests.

Answers one question: would the API accept this request exactly as the SDK
sent it? It resolves the operation for a method and URL, checks query
parameters against the declared ones, and validates the JSON body against the
operation's request schema.

Unknown body keys are an error unless the schema explicitly allows extra
properties: the API strips undeclared keys silently, so a field the SDK sends
that the API does not declare is a field the caller thinks is doing something
and is not.

Mirrors ``packages/node/test/helpers/openapi.ts``. Only the JSON Schema
keywords the spec actually uses are implemented.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, unquote, urlsplit

SPEC_PATH = Path(__file__).resolve().parents[3] / "specs" / "openapi.json"
SPEC: dict[str, Any] = json.loads(SPEC_PATH.read_text())


def _resolve(schema: dict[str, Any]) -> dict[str, Any]:
    ref = schema.get("$ref")
    if not ref:
        return schema
    name = ref.replace("#/components/schemas/", "")
    return _resolve(SPEC["components"]["schemas"][name])


def find_operation(method: str, path: str) -> tuple[str, dict[str, Any]] | None:
    parts = [unquote(p) for p in path.split("/") if p]
    best: tuple[int, str, dict[str, Any]] | None = None
    for template, ops in SPEC["paths"].items():
        op = ops.get(method.lower())
        if op is None:
            continue
        tparts = [p for p in template.split("/") if p]
        if len(tparts) != len(parts):
            continue
        literals = 0
        ok = True
        for t, actual in zip(tparts, parts, strict=True):
            if t.startswith("{") and t.endswith("}"):
                ok = bool(actual)
            elif t == actual:
                literals += 1
            else:
                ok = False
            if not ok:
                break
        if ok and (best is None or literals > best[0]):
            best = (literals, template, op)
    return (best[1], best[2]) if best else None


def _type_of(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "integer" if value.is_integer() else "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def validate(raw_schema: dict[str, Any], value: Any, at: str) -> list[str]:
    schema = _resolve(raw_schema)
    problems: list[str] = []
    for sub in schema.get("allOf", []):
        problems += validate(sub, value, at)
    alternatives = schema.get("anyOf") or schema.get("oneOf")
    if alternatives:
        results = [validate(s, value, at) for s in alternatives]
        if not any(not r for r in results):
            firsts = " | ".join(r[0] for r in results)
            problems.append(f"{at}: matches none of the allowed shapes ({firsts})")
        return problems
    if value is None and schema.get("nullable"):
        return problems

    expected = schema.get("type")
    if expected:
        types = expected if isinstance(expected, list) else [expected]
        actual = _type_of(value)
        if not any(t == actual or (t == "number" and actual == "integer") for t in types):
            return [*problems, f"{at}: expected {'|'.join(types)}, got {actual}"]
    if "enum" in schema and value not in schema["enum"]:
        problems.append(f"{at}: {json.dumps(value)} is not one of {json.dumps(schema['enum'])}")
    if "const" in schema and value != schema["const"]:
        problems.append(f"{at}: expected {json.dumps(schema['const'])}")

    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            problems.append(f"{at}: shorter than {schema['minLength']}")
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            problems.append(f"{at}: longer than {schema['maxLength']}")
        if "pattern" in schema and not re.search(schema["pattern"], value):
            problems.append(f"{at}: does not match {schema['pattern']}")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            problems.append(f"{at}: below {schema['minimum']}")
        if "maximum" in schema and value > schema["maximum"]:
            problems.append(f"{at}: above {schema['maximum']}")
        if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]:
            problems.append(f"{at}: not above {schema['exclusiveMinimum']}")
        if "exclusiveMaximum" in schema and value >= schema["exclusiveMaximum"]:
            problems.append(f"{at}: not below {schema['exclusiveMaximum']}")
    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            problems.append(f"{at}: fewer than {schema['minItems']} items")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            problems.append(f"{at}: more than {schema['maxItems']} items")
        if "items" in schema:
            for i, item in enumerate(value):
                problems += validate(schema["items"], item, f"{at}[{i}]")
    if isinstance(value, dict):
        for key in schema.get("required", []):
            if key not in value:
                problems.append(f"{at}.{key}: required by the API but not sent")
        props = schema.get("properties")
        for key, item in value.items():
            if props is not None and key in props:
                problems += validate(props[key], item, f"{at}.{key}")
            elif props is not None:
                extra = schema.get("additionalProperties")
                if extra is False:
                    problems.append(f"{at}.{key}: rejected by the API (not an allowed property)")
                elif extra is None:
                    problems.append(f"{at}.{key}: not in the API schema, so the API silently drops it")
                elif isinstance(extra, dict):
                    problems += validate(extra, item, f"{at}.{key}")
    return problems


def _coerce_query(schema: dict[str, Any], raw: str) -> Any:
    s = _resolve(schema)
    t = s.get("type")
    types = t if isinstance(t, list) else [t]
    if "integer" in types or "number" in types:
        try:
            return int(raw)
        except ValueError:
            try:
                return float(raw)
            except ValueError:
                return raw
    if "boolean" in types:
        return {"true": True, "false": False}.get(raw, raw)
    if "array" in types:
        return raw.split(",")
    return raw


def check_request(
    method: str, url: str, body: Any, *, undeclared_query: tuple[str, ...] = ()
) -> list[str]:
    """Every reason the API would reject or ignore part of this request."""
    split = urlsplit(url)
    resolved = find_operation(method, split.path)
    if resolved is None:
        return [f"{method} {split.path}: no such operation in specs/openapi.json"]
    template, op = resolved
    label = f"{method} {template}"
    problems: list[str] = []

    declared = {p["name"]: p for p in op.get("parameters", []) if p.get("in") == "query"}
    sent = parse_qsl(split.query, keep_blank_values=True)
    for name, raw in sent:
        param = declared.get(name)
        if param is None:
            if name not in undeclared_query:
                problems.append(f'{label}: query parameter "{name}" is not declared')
            continue
        if "schema" in param:
            value = _coerce_query(param["schema"], raw)
            problems += validate(param["schema"], value, f"{label} ?{name}")
    sent_names = {n for n, _ in sent}
    for name, param in declared.items():
        if param.get("required") and name not in sent_names:
            problems.append(f'{label}: required query parameter "{name}" missing')

    request_body = op.get("requestBody") or {}
    schema = request_body.get("content", {}).get("application/json", {}).get("schema")
    if body is None:
        if request_body.get("required"):
            problems.append(f"{label}: request body required but not sent")
    elif schema is None:
        problems.append(f"{label}: sends a body but the operation declares none")
    else:
        problems += validate(schema, body, f"{label} body")
    return problems


def body_schema_at(method: str, template: str, dotted: str) -> dict[str, Any]:
    op = SPEC["paths"][template][method.lower()]
    schema: dict[str, Any] = op["requestBody"]["content"]["application/json"]["schema"]
    for part in [p for p in dotted.split(".") if p]:
        schema = _resolve(schema)
        match = re.fullmatch(r"anyOf\[(\d+)\]", part)
        if part == "items":
            schema = schema["items"]
        elif match:
            schema = schema["anyOf"][int(match.group(1))]
        else:
            schema = schema["properties"][part]
    return _resolve(schema)


def query_schema(method: str, template: str, name: str) -> dict[str, Any]:
    op = SPEC["paths"][template][method.lower()]
    for param in op.get("parameters", []):
        if param.get("in") == "query" and param["name"] == name:
            return _resolve(param["schema"])
    raise KeyError(f"{method} {template}: no query parameter {name}")
