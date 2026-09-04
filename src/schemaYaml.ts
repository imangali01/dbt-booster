/**
 * PURE: read and write a model's `schema.yml` doc block (description, column
 * descriptions, column tests) via round-trip YAML editing — other content in
 * the file (other models, comments, formatting) is left untouched. Supports
 * both the legacy `tests:` key and the current `data_tests:` key, preserving
 * whichever one a given model block already uses.
 */
import { Document, isMap, isSeq, parseDocument, type YAMLMap, type YAMLSeq } from 'yaml';

export type TestDoc =
  | { kind: 'not_null' | 'unique' }
  | { kind: 'relationships'; to: string; field: string }
  | { kind: 'accepted_values'; values: string[] }
  /** Anything else, kept as a raw YAML fragment (e.g. a custom generic test). */
  | { kind: 'custom'; raw: string };

export interface ColumnDoc {
  name: string;
  description: string;
  tests: TestDoc[];
}

export interface ModelDoc {
  description: string;
  columns: ColumnDoc[];
}

const TESTS_KEY = 'data_tests';
const LEGACY_TESTS_KEY = 'tests';

function testFromPlain(value: unknown): TestDoc {
  if (typeof value === 'string') {
    return value === 'not_null' || value === 'unique' ? { kind: value } : { kind: 'custom', raw: value };
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 1 && keys[0] === 'relationships' && isRecord(obj.relationships)) {
      return {
        kind: 'relationships',
        to: String(obj.relationships.to ?? ''),
        field: String(obj.relationships.field ?? ''),
      };
    }
    if (keys.length === 1 && keys[0] === 'accepted_values' && isRecord(obj.accepted_values)) {
      const values = obj.accepted_values.values;
      return {
        kind: 'accepted_values',
        values: Array.isArray(values) ? values.map(String) : [],
      };
    }
  }
  return { kind: 'custom', raw: yamlFragment(value) };
}

function testToPlain(test: TestDoc): unknown {
  switch (test.kind) {
    case 'not_null':
    case 'unique':
      return test.kind;
    case 'relationships':
      return { relationships: { to: test.to, field: test.field } };
    case 'accepted_values':
      return { accepted_values: { values: test.values } };
    case 'custom':
      return parseCustomTest(test.raw);
  }
}

function parseCustomTest(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    return trimmed;
  }
  try {
    return parseDocument(trimmed).toJSON();
  } catch {
    return trimmed;
  }
}

function yamlFragment(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  return new Document(value).toString().trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findModelsSeq(doc: Document): YAMLSeq | undefined {
  const node = doc.contents && isMap(doc.contents) ? doc.contents.get('models', true) : undefined;
  return isSeq(node) ? node : undefined;
}

function findModelMap(modelsSeq: YAMLSeq | undefined, modelName: string): YAMLMap | undefined {
  if (!modelsSeq) {
    return undefined;
  }
  return modelsSeq.items.find(
    (item): item is YAMLMap => isMap(item) && item.get('name') === modelName,
  );
}

/**
 * Read `modelName`'s doc block out of `yamlText`. Returns an empty
 * `ModelDoc` (not an error) when the file is blank, doesn't declare
 * `models:`, or doesn't document this model yet — the caller treats that as
 * "nothing written yet", ready to be filled in and saved as a new entry.
 */
export function readModelDoc(yamlText: string, modelName: string): ModelDoc {
  if (!yamlText.trim()) {
    return { description: '', columns: [] };
  }
  const doc = parseDocument(yamlText);
  const modelMap = findModelMap(findModelsSeq(doc), modelName);
  if (!modelMap) {
    return { description: '', columns: [] };
  }

  const description = stringOr(modelMap.get('description'), '');
  const columnsNode = modelMap.get('columns');
  const columns: ColumnDoc[] = [];
  if (isSeq(columnsNode)) {
    for (const colNode of columnsNode.items) {
      if (!isMap(colNode)) {
        continue;
      }
      const testsNode = colNode.get(TESTS_KEY) ?? colNode.get(LEGACY_TESTS_KEY);
      const testsPlain = isSeq(testsNode) ? (testsNode.toJSON() as unknown[]) : [];
      const tests = testsPlain.map(testFromPlain);
      columns.push({
        name: stringOr(colNode.get('name'), ''),
        description: stringOr(colNode.get('description'), ''),
        tests,
      });
    }
  }
  return { description, columns };
}

/** True when `yamlText` already has a doc block for `modelName`. */
export function hasModelDoc(yamlText: string, modelName: string): boolean {
  if (!yamlText.trim()) {
    return false;
  }
  return findModelMap(findModelsSeq(parseDocument(yamlText)), modelName) !== undefined;
}

/**
 * Write `modelDoc` back into `yamlText` as `modelName`'s doc block, creating
 * `models:` / the model entry if they don't exist yet. Every other entry in
 * the document (other models, comments, formatting) is left as-is; only the
 * target model's `description` and `columns` are replaced wholesale — the
 * form is the source of truth for what it can represent, so this doesn't try
 * to preserve hand-written structure *within* that one model's block.
 */
export function applyModelDoc(yamlText: string, modelName: string, modelDoc: ModelDoc): string {
  const doc = yamlText.trim() ? parseDocument(yamlText) : new Document({ version: 2 });
  if (!doc.contents || !isMap(doc.contents)) {
    doc.contents = doc.createNode({});
  }
  const root = doc.contents as YAMLMap;

  let modelsSeq = findModelsSeq(doc);
  if (!modelsSeq) {
    modelsSeq = doc.createNode([]) as YAMLSeq;
    root.set('models', modelsSeq);
  }

  let modelMap = findModelMap(modelsSeq, modelName);
  const existingTestsKey = modelMap ? detectTestsKey(modelMap) : TESTS_KEY;
  if (!modelMap) {
    modelMap = doc.createNode({ name: modelName }) as YAMLMap;
    modelsSeq.items.push(modelMap);
  }

  if (modelDoc.description.trim()) {
    modelMap.set('description', modelDoc.description);
  } else {
    modelMap.delete('description');
  }

  if (modelDoc.columns.length > 0) {
    const columnsPlain = modelDoc.columns.map((col) => {
      const plain: Record<string, unknown> = { name: col.name };
      if (col.description.trim()) {
        plain.description = col.description;
      }
      if (col.tests.length > 0) {
        plain[existingTestsKey] = col.tests.map(testToPlain);
      }
      return plain;
    });
    modelMap.set('columns', doc.createNode(columnsPlain));
  } else {
    modelMap.delete('columns');
  }

  return doc.toString();
}

function detectTestsKey(modelMap: YAMLMap): typeof TESTS_KEY | typeof LEGACY_TESTS_KEY {
  const columnsNode = modelMap.get('columns');
  if (isSeq(columnsNode)) {
    for (const colNode of columnsNode.items) {
      if (isMap(colNode) && colNode.has(LEGACY_TESTS_KEY) && !colNode.has(TESTS_KEY)) {
        return LEGACY_TESTS_KEY;
      }
    }
  }
  return TESTS_KEY;
}

function stringOr(value: unknown, fallback: string): string {
  return value === undefined || value === null ? fallback : String(value);
}
