import Parser, { type SyntaxNode } from "tree-sitter";
import Python from "tree-sitter-python";
import { emptyParseResult, type ParseResult } from "../types.js";

const nodeLine = (node: SyntaxNode): number => node.startPosition.row + 1;
const nodeEndLine = (node: SyntaxNode): number => node.endPosition.row + 1;

const walk = (node: SyntaxNode, visit: (current: SyntaxNode) => void): void => {
  visit(node);

  for (const child of node.namedChildren) {
    walk(child, visit);
  }
};

const fieldText = (node: SyntaxNode, fieldName: string): string | null => {
  return node.childForFieldName(fieldName)?.text ?? null;
};

const isModuleLevelDefinition = (node: SyntaxNode): boolean => {
  if (node.parent?.type === "module") {
    return true;
  }

  return (
    node.parent?.type === "decorated_definition" &&
    node.parent.parent?.type === "module"
  );
};

const decoratorNames = (node: SyntaxNode): string[] => {
  const decoratedDefinition =
    node.parent?.type === "decorated_definition" ? node.parent : null;

  if (decoratedDefinition === null) {
    return [];
  }

  return decoratedDefinition.namedChildren
    .filter((child) => child.type === "decorator")
    .map((decorator) => decorator.text.replace(/^@/, "").trim());
};

const importSource = (node: SyntaxNode): string | null => {
  if (node.type === "import_statement") {
    return node.text.replace(/^import\s+/, "").split(/\s+as\s+/)[0] ?? null;
  }

  if (node.type === "import_from_statement") {
    const moduleName = node.childForFieldName("module_name")?.text;
    const dottedName = node.namedChildren.find(
      (child) => child.type === "dotted_name"
    )?.text;
    return moduleName ?? dottedName ?? null;
  }

  return null;
};

export const parsePython = (content: string): ParseResult => {
  try {
    const parser = new Parser();
    parser.setLanguage(Python as Parser.Language);
    const tree = parser.parse(content);
    const result = emptyParseResult();

    walk(tree.rootNode, (node) => {
      if (node.type === "function_definition") {
        const name = fieldText(node, "name");
        if (name === null) {
          return;
        }

        result.functions.push({
          name,
          startLine: nodeLine(node),
          endLine: nodeEndLine(node),
          params: [],
          isExported: isModuleLevelDefinition(node),
          decorators: decoratorNames(node)
        });

        if (isModuleLevelDefinition(node)) {
          result.exports.push({ name, type: "function" });
        }
      }

      if (node.type === "class_definition") {
        const name = fieldText(node, "name");
        if (name === null) {
          return;
        }

        result.classes.push({
          name,
          startLine: nodeLine(node),
          endLine: nodeEndLine(node),
          isExported: isModuleLevelDefinition(node)
        });

        if (isModuleLevelDefinition(node)) {
          result.exports.push({ name, type: "class" });
        }
      }

      if (node.type === "import_statement" || node.type === "import_from_statement") {
        const source = importSource(node);
        if (source !== null) {
          result.imports.push({
            source,
            specifiers: [],
            isExternal: true
          });
        }
      }
    });

    return result;
  } catch {
    return emptyParseResult();
  }
};
