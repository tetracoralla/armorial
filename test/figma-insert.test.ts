/// <reference types="@figma/plugin-typings" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_POLICY } from "../src/core/contracts.js";
import { finalizeSvg } from "../src/core/svg.js";
import { insertIconIntoFigma } from "../src/figma/insert.js";
import type { FigmaInsertRequest, FigmaInsertSettings } from "../src/figma/protocol.js";

let nodeSequence = 0;

class FakeNode {
  readonly id = `fake:${++nodeSequence}`;
  name = "";
  parent: FakeNode | null = null;
  children: FakeNode[] = [];
  x = 0;
  y = 0;
  width = 24;
  height = 24;
  layoutMode = "NONE";
  layoutPositioning = "AUTO";
  fills: Array<{ type: string; visible?: boolean }> = [];
  strokes: Array<{ type: string; visible?: boolean }> = [];

  constructor(readonly type: string) {}

  appendChild(child: FakeNode): void {
    child.remove();
    this.children.push(child);
    child.parent = this;
  }

  insertChild(index: number, child: FakeNode): void {
    child.remove();
    this.children.splice(index, 0, child);
    child.parent = this;
  }

  remove(): void {
    if (this.parent === null) return;
    const index = this.parent.children.indexOf(this);
    if (index >= 0) this.parent.children.splice(index, 1);
    this.parent = null;
  }

  findAll(predicate: (node: FakeNode) => boolean): FakeNode[] {
    const result: FakeNode[] = [];
    const visit = (node: FakeNode) => {
      for (const child of node.children) {
        if (predicate(child)) result.push(child);
        visit(child);
      }
    };
    visit(this);
    return result;
  }

  outlineStroke(): FakeNode | null {
    if (this.strokes.length === 0) return null;
    const outlined = new FakeNode("VECTOR");
    outlined.fills = [{ type: "SOLID" }];
    return outlined;
  }
}

class FakeFigma {
  readonly currentPage = new FakeNode("PAGE");
  readonly viewport = {
    center: { x: 120, y: 80 },
    scrolled: [] as FakeNode[],
    scrollAndZoomIntoView: (nodes: FakeNode[]) => {
      this.viewport.scrolled = nodes;
    },
  };
  createNodeCalls = 0;
  flattenCalls = 0;
  unionCalls = 0;

  constructor() {
    this.currentPage.name = "Acceptance";
    (this.currentPage as FakeNode & { selection: FakeNode[] }).selection = [];
  }

  // Figma's createNodeFromSvg returns a frame that is not yet in the document;
  // geometry operations and component conversion expect an appended node.
  createNodeFromSvg(_svg: string): FakeNode {
    this.createNodeCalls += 1;
    const root = new FakeNode("FRAME");
    root.fills = [{ type: "SOLID" }];
    root.strokes = [{ type: "SOLID" }];
    const vector = new FakeNode("VECTOR");
    vector.name = "Path";
    vector.strokes = [{ type: "SOLID" }];
    root.appendChild(vector);
    return root;
  }

  createComponentFromNode(node: FakeNode): FakeNode {
    const parent = node.parent;
    if (parent === null) throw new Error("Cannot create component from detached node");
    const index = parent.children.indexOf(node);
    const component = new FakeNode("COMPONENT");
    component.x = node.x;
    component.y = node.y;
    component.width = node.width;
    component.height = node.height;
    component.fills = [...node.fills];
    component.strokes = [...node.strokes];
    for (const child of [...node.children]) component.appendChild(child);
    node.remove();
    parent.insertChild(index, component);
    return component;
  }

  flatten(nodes: FakeNode[], parent: FakeNode): FakeNode {
    this.flattenCalls += 1;
    return this.merge(nodes, parent, "VECTOR");
  }

  union(nodes: FakeNode[], parent: FakeNode): FakeNode {
    this.unionCalls += 1;
    return this.merge(nodes, parent, "BOOLEAN_OPERATION");
  }

  private merge(nodes: FakeNode[], parent: FakeNode, type: string): FakeNode {
    const index = Math.max(0, parent.children.indexOf(nodes[0]!));
    for (const node of nodes) node.remove();
    const merged = new FakeNode(type);
    parent.insertChild(index, merged);
    return merged;
  }
}

const rendered = finalizeSvg(
  "search",
  '<svg width="24" height="24" viewBox="0 0 48 48"><path d="M0 0h1" stroke="#111"/></svg>',
  DEFAULT_POLICY.defaults,
);

function request(settings: Partial<FigmaInsertSettings> = {}): FigmaInsertRequest {
  return {
    type: "insert-icon",
    requestId: "request-1",
    asset: {
      id: "icon-park:search",
      name: "search",
      svg: rendered.svg,
      sha256: rendered.sha256,
    },
    settings: {
      createComponent: true,
      outlineStroke: false,
      layerStructure: "preserve",
      layerName: "icon-name",
      ...settings,
    },
  };
}

test("click insertion creates a real component master at the viewport center", () => {
  const fake = new FakeFigma();
  const receipt = insertIconIntoFigma(fake as unknown as PluginAPI, request(), { kind: "click" });
  const inserted = fake.currentPage.children[0]!;

  assert.equal(receipt.nodeType, "COMPONENT");
  assert.equal(receipt.component, true);
  assert.equal(inserted.name, "Icon/search");
  assert.deepEqual(inserted.fills, []);
  assert.deepEqual(inserted.strokes, []);
  assert.equal(inserted.x, 108);
  assert.equal(inserted.y, 68);
  assert.deepEqual(fake.viewport.scrolled, [inserted]);
});

test("drop insertion reparents to the actual target and preserves relative coordinates", () => {
  const fake = new FakeFigma();
  const target = new FakeNode("FRAME");
  target.name = "Target";
  fake.currentPage.appendChild(target);

  const receipt = insertIconIntoFigma(
    fake as unknown as PluginAPI,
    request({ createComponent: false }),
    { kind: "drop", target: target as unknown as BaseNode, x: 35, y: 42, absoluteX: 300, absoluteY: 400 },
  );
  const inserted = target.children[0]!;
  assert.equal(receipt.parentId, target.id);
  assert.equal(receipt.placement, "drop");
  assert.equal(inserted.x, 35);
  assert.equal(inserted.y, 42);
});

test("drop insertion keeps an exact absolute position inside auto-layout targets", () => {
  const fake = new FakeFigma();
  const target = new FakeNode("FRAME");
  target.name = "Auto layout target";
  target.layoutMode = "HORIZONTAL";
  fake.currentPage.appendChild(target);

  const receipt = insertIconIntoFigma(
    fake as unknown as PluginAPI,
    request({ createComponent: false }),
    { kind: "drop", target: target as unknown as BaseNode, x: 19, y: 27, absoluteX: 300, absoluteY: 400 },
  );
  const inserted = target.children[0]!;
  assert.equal(receipt.parentId, target.id);
  assert.equal(inserted.layoutPositioning, "ABSOLUTE");
  assert.equal(inserted.x, 19);
  assert.equal(inserted.y, 27);
});

test("drop insertion rejects protected ancestors and falls back to the page root", () => {
  const fake = new FakeFigma();
  const instance = new FakeNode("INSTANCE");
  instance.name = "Protected instance";
  const nestedFrame = new FakeNode("FRAME");
  nestedFrame.name = "Nested frame";
  instance.appendChild(nestedFrame);
  fake.currentPage.appendChild(instance);

  const receipt = insertIconIntoFigma(
    fake as unknown as PluginAPI,
    request({ createComponent: false }),
    {
      kind: "drop",
      target: nestedFrame as unknown as BaseNode,
      x: 9,
      y: 11,
      absoluteX: 310,
      absoluteY: 420,
    },
  );
  const inserted = fake.currentPage.children.find((node) => node.id === receipt.nodeId)!;
  assert.equal(receipt.parentId, fake.currentPage.id);
  assert.equal(nestedFrame.children.length, 0);
  assert.equal(inserted.x, 310);
  assert.equal(inserted.y, 420);
});

test("outline and merge settings execute the requested Figma geometry operation", () => {
  const flattenFigma = new FakeFigma();
  const flattened = insertIconIntoFigma(
    flattenFigma as unknown as PluginAPI,
    request({ createComponent: false, outlineStroke: true, layerStructure: "flatten", layerName: "Vector" }),
    { kind: "click" },
  );
  assert.equal(flattened.outlinedNodeCount, 1);
  assert.equal(flattenFigma.flattenCalls, 1);
  assert.equal(flattenFigma.currentPage.children[0]?.children[0]?.type, "VECTOR");
  assert.equal(flattenFigma.currentPage.children[0]?.children[0]?.name, "Vector");

  const unionFigma = new FakeFigma();
  insertIconIntoFigma(
    unionFigma as unknown as PluginAPI,
    request({ createComponent: false, layerStructure: "union", layerName: "Union" }),
    { kind: "click" },
  );
  assert.equal(unionFigma.unionCalls, 1);
  assert.equal(unionFigma.currentPage.children[0]?.children[0]?.type, "BOOLEAN_OPERATION");
  assert.equal(unionFigma.currentPage.children[0]?.children[0]?.name, "Union");
});

test("tampered SVG is rejected before Figma receives a write", () => {
  const fake = new FakeFigma();
  const tampered = request();
  tampered.asset.sha256 = "0".repeat(64);
  assert.throws(
    () => insertIconIntoFigma(fake as unknown as PluginAPI, tampered, { kind: "click" }),
    /changed after rendering/,
  );
  assert.equal(fake.createNodeCalls, 0);
  assert.equal(fake.currentPage.children.length, 0);
});
