import { useCallback, useEffect, useState } from 'react';
import './styles.css';
import type { DocsExtensionToWebview } from '../docsProtocol';
import type { ColumnDoc, ModelDoc, TestDoc } from '../schemaYaml';
import vscode from './vscodeApi';

type ViewState =
  | { kind: 'initial' }
  | { kind: 'empty'; reason: string }
  | { kind: 'loaded'; modelName: string; yamlPath: string; doc: ModelDoc };

function emptyColumn(): ColumnDoc {
  return { name: '', description: '', tests: [] };
}

function testLabel(test: TestDoc): string {
  switch (test.kind) {
    case 'not_null':
    case 'unique':
      return test.kind;
    case 'relationships':
      return `relationships → ${test.to}.${test.field}`;
    case 'accepted_values':
      return `accepted_values: ${test.values.join(', ')}`;
    case 'custom':
      return test.raw;
  }
}

/** Structural equality for "is this exact test already on the column". */
function testsEqual(a: TestDoc, b: TestDoc): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  switch (a.kind) {
    case 'not_null':
    case 'unique':
      return true;
    case 'relationships':
      return b.kind === 'relationships' && a.to === b.to && a.field === b.field;
    case 'accepted_values':
      return (
        b.kind === 'accepted_values' &&
        a.values.length === b.values.length &&
        a.values.every((v, i) => v === b.values[i])
      );
    case 'custom':
      return b.kind === 'custom' && a.raw.trim() === b.raw.trim();
  }
}

function TestAdder({
  onAdd,
  isDuplicate,
}: {
  onAdd: (test: TestDoc) => void;
  isDuplicate: (test: TestDoc) => boolean;
}): JSX.Element {
  const [kind, setKind] = useState<TestDoc['kind']>('not_null');
  const [to, setTo] = useState('');
  const [field, setField] = useState('');
  const [values, setValues] = useState('');
  const [raw, setRaw] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState(false);

  const tryAdd = (test: TestDoc): boolean => {
    if (isDuplicate(test)) {
      setDuplicateWarning(true);
      setTimeout(() => setDuplicateWarning(false), 1500);
      return false;
    }
    onAdd(test);
    return true;
  };

  const add = (): void => {
    if (kind === 'not_null' || kind === 'unique') {
      tryAdd({ kind });
      return;
    }
    if (kind === 'relationships') {
      if (!to.trim() || !field.trim()) {
        return;
      }
      if (tryAdd({ kind: 'relationships', to: to.trim(), field: field.trim() })) {
        setTo('');
        setField('');
      }
      return;
    }
    if (kind === 'accepted_values') {
      const list = values
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      if (list.length === 0) {
        return;
      }
      if (tryAdd({ kind: 'accepted_values', values: list })) {
        setValues('');
      }
      return;
    }
    if (raw.trim() && tryAdd({ kind: 'custom', raw: raw.trim() })) {
      setRaw('');
    }
  };

  return (
    <div className="dp-test-adder">
      <select value={kind} onChange={(e) => setKind(e.target.value as TestDoc['kind'])}>
        <option value="not_null">not_null</option>
        <option value="unique">unique</option>
        <option value="relationships">relationships</option>
        <option value="accepted_values">accepted_values</option>
        <option value="custom">custom…</option>
      </select>
      {kind === 'relationships' ? (
        <>
          <input
            placeholder="to, e.g. ref('customers')"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <input placeholder="field" value={field} onChange={(e) => setField(e.target.value)} />
        </>
      ) : null}
      {kind === 'accepted_values' ? (
        <input
          placeholder="comma-separated values"
          value={values}
          onChange={(e) => setValues(e.target.value)}
        />
      ) : null}
      {kind === 'custom' ? (
        <input
          placeholder="raw test YAML, e.g. dbt_utils.accepted_range: {min_value: 0}"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
        />
      ) : null}
      <button type="button" onClick={add}>
        + Add test
      </button>
      {duplicateWarning ? <span className="dp-test-warning">Already added</span> : null}
    </div>
  );
}

function ColumnRow({
  column,
  onChange,
  onRemove,
}: {
  column: ColumnDoc;
  onChange: (next: ColumnDoc) => void;
  onRemove: () => void;
}): JSX.Element {
  return (
    <div className="dp-column">
      <div className="dp-column-head">
        <input
          className="dp-column-name"
          placeholder="column name"
          value={column.name}
          onChange={(e) => onChange({ ...column, name: e.target.value })}
        />
        <button type="button" className="dp-remove" title="Remove column" onClick={onRemove}>
          ×
        </button>
      </div>
      <textarea
        className="dp-column-desc"
        placeholder="Column description"
        rows={2}
        value={column.description}
        onChange={(e) => onChange({ ...column, description: e.target.value })}
      />
      <div className="dp-tests">
        {column.tests.map((test, i) => (
          <span className="dp-test-chip" key={i}>
            {testLabel(test)}
            <button
              type="button"
              title="Remove test"
              onClick={() => onChange({ ...column, tests: column.tests.filter((_, j) => j !== i) })}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <TestAdder
        onAdd={(test) => onChange({ ...column, tests: [...column.tests, test] })}
        isDuplicate={(test) => column.tests.some((existing) => testsEqual(existing, test))}
      />
    </div>
  );
}

export function DocsApp(): JSX.Element {
  const [state, setState] = useState<ViewState>({ kind: 'initial' });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);

  useEffect(() => {
    const onMessage = (event: MessageEvent<DocsExtensionToWebview>): void => {
      const message = event.data;
      if (message.type === 'doc') {
        setState({
          kind: 'loaded',
          modelName: message.modelName,
          yamlPath: message.yamlPath,
          doc: message.doc,
        });
        setDirty(false);
        setSaving(false);
        setSaveError(undefined);
      } else if (message.type === 'empty') {
        setState({ kind: 'empty', reason: message.reason });
      } else if (message.type === 'saved') {
        setSaving(false);
        setDirty(false);
        setSaveError(undefined);
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 1500);
      } else if (message.type === 'saveError') {
        setSaving(false);
        setSaveError(message.message);
      }
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const update = useCallback((next: ModelDoc) => {
    setState((s) => (s.kind === 'loaded' ? { ...s, doc: next } : s));
    setDirty(true);
  }, []);

  const save = useCallback(() => {
    if (state.kind !== 'loaded') {
      return;
    }
    setSaving(true);
    vscode.postMessage({ type: 'save', doc: state.doc });
  }, [state]);

  if (state.kind !== 'loaded') {
    return (
      <div className="dp-empty">{state.kind === 'initial' ? 'Loading…' : state.reason}</div>
    );
  }

  const { doc } = state;

  return (
    <div className="dp-root">
      <div className="dp-header">
        <h2>{state.modelName}</h2>
        <button type="button" className="dp-save" disabled={!dirty || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {savedFlash ? <span className="dp-saved">Saved</span> : null}
        {dirty && !saving ? <span className="dp-dirty">Unsaved changes</span> : null}
      </div>
      {saveError ? <div className="dp-error">{saveError}</div> : null}
      <div className="dp-path" title={state.yamlPath}>
        {state.yamlPath}
      </div>

      <label className="dp-label">Description</label>
      <textarea
        className="dp-model-desc"
        rows={3}
        value={doc.description}
        onChange={(e) => update({ ...doc, description: e.target.value })}
      />

      <div className="dp-columns-header">
        <label className="dp-label">Columns</label>
        <button
          type="button"
          onClick={() => update({ ...doc, columns: [...doc.columns, emptyColumn()] })}
        >
          + Add Column
        </button>
      </div>
      {doc.columns.map((col, i) => (
        <ColumnRow
          key={i}
          column={col}
          onChange={(next) => {
            const columns = [...doc.columns];
            columns[i] = next;
            update({ ...doc, columns });
          }}
          onRemove={() => update({ ...doc, columns: doc.columns.filter((_, j) => j !== i) })}
        />
      ))}
    </div>
  );
}
