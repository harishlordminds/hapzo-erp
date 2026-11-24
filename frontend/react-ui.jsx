import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

// Each full workspace render starts a fresh form, including file inputs and draft controls.
const roots = new WeakMap();
let revision = 0;
function display(container, children) {
  let root = roots.get(container);
  if (!root) {
    root = createRoot(container);
    roots.set(container, root);
  }
  flushSync(() => root.render(<Fragment key={++revision}>{children}</Fragment>));
}
export const renderApp = (children) => display(document.getElementById('app'), children);
export const renderDialog = (children) => display(document.getElementById('detail-dialog'), children);
export const renderPilot = display;
export function joinContent(items, separator = '') {
  if (!items.length) return '';
  if (!isValidElement(separator) && items.every((item) => !isValidElement(item) && !Array.isArray(item))) {
    return items.join(separator);
  }
  return Children.toArray(separator ? items.flatMap((item, index) => (index ? [separator, item] : [item])) : items);
}

// Calculators and dependent dropdowns can update their results without resetting the enclosing form.
const controls = new WeakMap();
function useContents(children) {
  const [content, setContent] = useState(() => children);
  const ref = useCallback((node) => {
    if (!node) return;
    controls.set(node, setContent);
    return () => controls.delete(node);
  }, []);
  return [ref, content];
}
export function setContents(node, children) {
  const update = controls.get(node);
  if (!update) throw new Error('This field is no longer displayed.');
  flushSync(() => update(() => children));
}
export function appendContents(node, children) {
  const update = controls.get(node);
  if (!update) throw new Error('This field is no longer displayed.');
  flushSync(() =>
    update((previous) => (
      <>
        {previous}
        {children}
      </>
    )),
  );
}
export function EditableContent({ as: Element, children, ...props }) {
  const [ref, content] = useContents(children);
  return (
    <Element {...props} ref={ref}>
      {content}
    </Element>
  );
}
export function SelectControl({ children, ...props }) {
  const [register, content] = useContents(children);
  const select = useRef(null);
  let selected;
  function options(nodes) {
    return Children.map(nodes, (child) => {
      if (!isValidElement(child)) return child;
      if (child.type === Fragment) return options(child.props.children);
      if (child.type === 'option' && 'selected' in child.props) {
        if (child.props.selected) selected = child.props.value;
        return cloneElement(child, {
          selected: undefined,
        });
      }
      return child;
    });
  }
  const choices = options(content);
  const ref = useCallback(
    (node) => {
      select.current = node;
      return register(node);
    },
    [register],
  );
  useLayoutEffect(() => {
    if (selected !== undefined) select.current.value = selected;
  }, [content, selected]);
  return (
    <select {...props} ref={ref} defaultValue={selected ?? props.defaultValue}>
      {choices}
    </select>
  );
}
const rowLists = new WeakMap();
const templates = new WeakMap();

export function RowList({ as: Element = 'div', children, ...props }) {
  const [rows, setRows] = useState(() => Children.toArray(children).filter(isValidElement)
    .map((content, id) => ({ id, content })));
  const nextId = useRef(rows.length);
  const ref = useCallback(node => {
    if (!node) return;
    rowLists.set(node, {
      append(content) {
        const id = nextId.current++;
        setRows(current => [...current, { id, content }]);
      },
      remove(index) { setRows(current => current.filter((_, i) => i !== index)); },
    });
    return () => { rowLists.delete(node); };
  }, []);
  return <Element ref={ref} {...props}>{rows.map(row => <Fragment key={row.id}>{row.content}</Fragment>)}</Element>;
}

export function RowTemplate({ children, ...props }) {
  return <template {...props} ref={node => {
    if (node) templates.set(node, children);
  }} />;
}

export function appendRow(list, template) {
  flushSync(() => rowLists.get(list).append(templates.get(template)));
}

export function removeRow(row) {
  const list = row.parentElement;
  const index = Array.from(list.children).indexOf(row);
  flushSync(() => rowLists.get(list).remove(index));
}
