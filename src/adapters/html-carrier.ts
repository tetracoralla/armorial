import { performance } from "node:perf_hooks";
import {
  defaultTreeAdapter,
  Parser,
  Token,
  type DefaultTreeAdapterMap,
  type DefaultTreeAdapterTypes,
  type TreeAdapter,
} from "parse5";
import { IconKernelError } from "../core/errors.js";

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const MAX_CARRIER_NODES = 50_000;
const MAX_CARRIER_ATTRIBUTES = 50_000;
const MAX_RETAINED_ATTRIBUTE_CODE_UNITS = 2 * 1024 * 1024;
const MAX_OPEN_ELEMENTS = 256;
const MAX_TOKEN_CODE_UNITS = 64 * 1024;
const PARSE_DEADLINE_MS = 5_000;
const WATCHDOG_INTERVAL = 4_096;

export const SPRITE_START_MARKER = "<!-- armorial:sprite:start -->";
export const SPRITE_END_MARKER = "<!-- armorial:sprite:end -->";

export type HtmlCarrierStructure = Readonly<{
  bodyContentStart: number;
  bodyContentEnd: number;
  startMarker?: Readonly<{ startOffset: number; endOffset: number }>;
  endMarker?: Readonly<{ startOffset: number; endOffset: number }>;
}>;

type InlineCarrierField = "inline-from" | "inline-into";

function invalidCarrier(message: string, field: InlineCarrierField): IconKernelError {
  return new IconKernelError({ code: "INVALID_INPUT", message, field });
}

function assertLexicalStringBound(field: InlineCarrierField, ...values: readonly (string | null | undefined)[]): void {
  if (values.some((value) => (value?.length ?? 0) > MAX_TOKEN_CODE_UNITS)) {
    throw invalidCarrier(`${field} HTML tokens must not exceed ${MAX_TOKEN_CODE_UNITS} UTF-16 code units.`, field);
  }
}

class CarrierLimits {
  private nodes = 0;
  private attributes = 0;
  private retainedAttributeCodeUnits = 0;
  private readonly deadline = performance.now() + PARSE_DEADLINE_MS;

  constructor(readonly field: InlineCarrierField) {}

  fail(message: string): IconKernelError {
    return invalidCarrier(message, this.field);
  }

  addNode<T>(value: T): T {
    this.nodes += 1;
    if (this.nodes > MAX_CARRIER_NODES) {
      throw this.fail(`${this.field} HTML must not exceed ${MAX_CARRIER_NODES} structural nodes.`);
    }
    return value;
  }

  recordNode(): void {
    this.addNode(undefined);
  }

  addAttributes(attributes: readonly { name: string; value: string }[]): void {
    this.attributes += attributes.length;
    for (const attribute of attributes) {
      assertLexicalStringBound(this.field, attribute.name, attribute.value);
      this.retainedAttributeCodeUnits += attribute.name.length + attribute.value.length;
    }
    if (
      this.attributes > MAX_CARRIER_ATTRIBUTES
      || this.retainedAttributeCodeUnits > MAX_RETAINED_ATTRIBUTE_CODE_UNITS
    ) {
      throw this.fail(`${this.field} HTML attributes exceed the supported structural budget.`);
    }
  }

  checkDeadline(): void {
    if (performance.now() > this.deadline) {
      throw this.fail(`${this.field} HTML parsing must complete within ${PARSE_DEADLINE_MS} milliseconds.`);
    }
  }
}

function createCarrierTreeAdapter(limits: CarrierLimits): TreeAdapter<DefaultTreeAdapterMap> {
  return {
    ...defaultTreeAdapter,
    createDocument() {
      return limits.addNode(defaultTreeAdapter.createDocument());
    },
    createDocumentFragment() {
      return limits.addNode(defaultTreeAdapter.createDocumentFragment());
    },
    createElement(tagName, namespaceURI, attributes) {
      assertLexicalStringBound(limits.field, tagName);
      limits.addAttributes(attributes);
      return limits.addNode(defaultTreeAdapter.createElement(tagName, namespaceURI, attributes));
    },
    adoptAttributes(recipient, attributes) {
      limits.addAttributes(attributes);
      defaultTreeAdapter.adoptAttributes(recipient, attributes);
    },
    createCommentNode(data) {
      // Marker identity is recovered from source offsets. Retaining arbitrary
      // comment payloads would duplicate caller-owned HTML in the parse tree.
      assertLexicalStringBound(limits.field, data);
      return limits.addNode(defaultTreeAdapter.createCommentNode(""));
    },
    createTextNode() {
      // The carrier check needs tree relationships, not text content. One
      // empty sentinel preserves parse5's text-node coalescing behavior.
      return limits.addNode(defaultTreeAdapter.createTextNode(""));
    },
    insertText(parentNode) {
      const previous = parentNode.childNodes.at(-1);
      if (previous === undefined || !defaultTreeAdapter.isTextNode(previous)) {
        defaultTreeAdapter.appendChild(parentNode, this.createTextNode(""));
      }
    },
    insertTextBefore(parentNode, _text, referenceNode) {
      const referenceIndex = parentNode.childNodes.indexOf(referenceNode);
      const previous = parentNode.childNodes[referenceIndex - 1];
      if (previous === undefined || !defaultTreeAdapter.isTextNode(previous)) {
        defaultTreeAdapter.insertBefore(parentNode, this.createTextNode(""), referenceNode);
      }
    },
    setDocumentType(document, name, publicId, systemId) {
      assertLexicalStringBound(limits.field, name, publicId, systemId);
      if (!document.childNodes.some((node) => defaultTreeAdapter.isDocumentTypeNode(node))) {
        limits.recordNode();
      }
      defaultTreeAdapter.setDocumentType(document, name, publicId, systemId);
    },
  };
}

type GuardedTokenizer = {
  _appendCharToCurrentCharacterToken(type: Token.CharacterToken["type"], character: string): void;
  _callState(codePoint: number): void;
  _emitCurrentCharacterToken(location: Token.Location | null): void;
  getCurrentLocation(offset: number): Token.Location | null;
  currentAttr?: { name?: string; value?: string };
  currentCharacterToken: Token.CharacterToken | null;
  currentLocation: Token.Location | null;
  currentToken?: {
    data?: string;
    name?: string | null;
    publicId?: string | null;
    systemId?: string | null;
    tagName?: string;
  } | null;
  preprocessor: { dropParsedChunk(): void };
};

function assertTokenizerTokenBound(tokenizer: GuardedTokenizer, limits: CarrierLimits): void {
  assertLexicalStringBound(
    limits.field,
    tokenizer.currentAttr?.name,
    tokenizer.currentAttr?.value,
    tokenizer.currentToken?.data,
    tokenizer.currentToken?.name,
    tokenizer.currentToken?.publicId,
    tokenizer.currentToken?.systemId,
    tokenizer.currentToken?.tagName,
  );
}

function installTokenizerGuards(parser: CarrierParser, limits: CarrierLimits): void {
  // parse5 8 groups adjacent character data into one token by default. On a
  // multi-megabyte text node that repeatedly copies an ever-growing string.
  // This pinned-version guard emits bounded chunks while leaving locations and
  // HTML5 tree construction under parse5's control.
  const tokenizer = parser.tokenizer as unknown as GuardedTokenizer;
  const appendCharacter = tokenizer._appendCharToCurrentCharacterToken;
  const callState = tokenizer._callState;
  if (typeof appendCharacter !== "function" || typeof callState !== "function") {
    throw new Error("Armorial inline parsing requires the pinned parse5 8 tokenizer contract.");
  }
  tokenizer._appendCharToCurrentCharacterToken = function boundedCharacterAppend(type, character) {
    appendCharacter.call(this, type, character);
    if ((this.currentCharacterToken?.chars.length ?? 0) >= MAX_TOKEN_CODE_UNITS) {
      this.currentLocation = this.getCurrentLocation(0);
      this._emitCurrentCharacterToken(this.currentLocation);
      this.preprocessor.dropParsedChunk();
      limits.checkDeadline();
    }
  };

  let processedSinceCheck = 0;
  tokenizer._callState = function boundedStateCall(codePoint) {
    callState.call(this, codePoint);
    processedSinceCheck += 1;
    if (processedSinceCheck >= WATCHDOG_INTERVAL) {
      processedSinceCheck = 0;
      assertTokenizerTokenBound(this, limits);
      limits.checkDeadline();
    }
  };
}

class CarrierParser extends Parser<DefaultTreeAdapterMap> {
  readonly bodyStartTags: Array<Readonly<{
    selfClosing: boolean;
    location: Token.TagToken["location"];
  }>> = [];
  readonly limits: CarrierLimits;

  constructor(treeAdapter: TreeAdapter<DefaultTreeAdapterMap>, limits: CarrierLimits) {
    super({ sourceCodeLocationInfo: true, treeAdapter });
    this.limits = limits;
  }

  override onItemPush(node: DefaultTreeAdapterTypes.ParentNode, tagId: number, isTop: boolean): void {
    super.onItemPush(node, tagId, isTop);
    if (this.openElements.stackTop + 1 > MAX_OPEN_ELEMENTS) {
      throw this.limits.fail(`${this.limits.field} HTML must not exceed ${MAX_OPEN_ELEMENTS} open elements.`);
    }
    this.limits.checkDeadline();
  }

  override onStartTag(token: Token.TagToken): void {
    assertLexicalStringBound(this.limits.field, token.tagName);
    if (token.tagName === "body") {
      if (this.bodyStartTags.length > 0) {
        throw this.limits.fail(`${this.limits.field} HTML must contain exactly one explicit, unambiguous body opening tag.`);
      }
      this.bodyStartTags.push({ selfClosing: token.selfClosing, location: token.location });
    }
    super.onStartTag(token);
  }

  override onEndTag(token: Token.TagToken): void {
    assertLexicalStringBound(this.limits.field, token.tagName);
    super.onEndTag(token);
  }
}

export function parseHtmlCarrierStructure(
  original: string,
  field: InlineCarrierField = "inline-into",
): HtmlCarrierStructure {
  const limits = new CarrierLimits(field);
  const treeAdapter = createCarrierTreeAdapter(limits);
  const parser = new CarrierParser(treeAdapter, limits);
  installTokenizerGuards(parser, limits);
  parser.tokenizer.write(original, true);
  limits.checkDeadline();

  const bodies: DefaultTreeAdapterTypes.Element[] = [];
  const comments: DefaultTreeAdapterTypes.CommentNode[] = [];
  const stack: DefaultTreeAdapterTypes.Node[] = [parser.document];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (
      treeAdapter.isElementNode(node)
      && node.tagName === "body"
      && node.namespaceURI === HTML_NAMESPACE
    ) {
      bodies.push(node);
    }
    if (treeAdapter.isCommentNode(node)) comments.push(node);
    if ("childNodes" in node) stack.push(...node.childNodes);
    if ("content" in node) stack.push(node.content);
  }

  const bodyToken = parser.bodyStartTags[0];
  const bodyTokenLocation = bodyToken?.location;
  const body = bodies[0];
  const bodyLocation = body?.sourceCodeLocation;
  const bodyStartLocation = bodyLocation?.startTag;
  if (
    parser.bodyStartTags.length !== 1
    || bodies.length !== 1
    || body === undefined
    || bodyToken?.selfClosing === true
    || bodyTokenLocation === undefined
    || bodyTokenLocation === null
    || bodyLocation === undefined
    || bodyLocation === null
    || bodyStartLocation === undefined
    || bodyStartLocation.startOffset !== bodyTokenLocation.startOffset
    || bodyStartLocation.endOffset !== bodyTokenLocation.endOffset
  ) {
    throw limits.fail(`${field} HTML must contain exactly one explicit, unambiguous body opening tag.`);
  }

  const bodyContentStart = bodyStartLocation.endOffset;
  const bodyContentEnd = bodyLocation.endTag?.startOffset ?? bodyLocation.endOffset;
  const markerComments = (marker: string) => comments.filter((comment) => {
    const location = comment.sourceCodeLocation;
    return location !== undefined
      && location !== null
      && original.slice(location.startOffset, location.endOffset) === marker;
  });
  const startMarkers = markerComments(SPRITE_START_MARKER);
  const endMarkers = markerComments(SPRITE_END_MARKER);
  if (startMarkers.length !== endMarkers.length || startMarkers.length > 1) {
    throw limits.fail(`${field} HTML contains an incomplete or duplicate Armorial sprite block.`);
  }

  const startMarkerNode = startMarkers[0];
  const endMarkerNode = endMarkers[0];
  const startMarker = startMarkerNode?.sourceCodeLocation ?? undefined;
  const endMarker = endMarkerNode?.sourceCodeLocation ?? undefined;
  const markerParent = startMarkerNode?.parentNode ?? null;
  const isLiveHtmlDescendant = (parent: DefaultTreeAdapterTypes.ParentNode | null): boolean => {
    if (
      parent === null
      || !treeAdapter.isElementNode(parent)
      || parent.namespaceURI !== HTML_NAMESPACE
    ) return false;
    let current: DefaultTreeAdapterTypes.ParentNode | null = parent;
    while (current !== null) {
      if (current === body) return true;
      current = treeAdapter.getParentNode(current) ?? null;
    }
    return false;
  };
  if (
    startMarkerNode !== undefined
    && endMarkerNode !== undefined
    && startMarker !== undefined
    && endMarker !== undefined
    && (
      markerParent !== endMarkerNode.parentNode
      || !isLiveHtmlDescendant(markerParent)
      || startMarker.startOffset < bodyContentStart
      || endMarker.endOffset > bodyContentEnd
      || startMarker.endOffset > endMarker.startOffset
    )
  ) {
    throw limits.fail(`${field} Armorial sprite block must be ordered inside the document body.`);
  }

  return {
    bodyContentStart,
    bodyContentEnd,
    ...(startMarker === undefined ? {} : { startMarker }),
    ...(endMarker === undefined ? {} : { endMarker }),
  };
}
