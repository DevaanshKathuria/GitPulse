import path from "node:path";

export const detectLanguage = (filePath: string): string | null => {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case ".ts":
    case ".tsx":
      return "typescript";
    case ".js":
    case ".jsx":
      return "javascript";
    case ".py":
      return "python";
    case ".go":
      return "go";
    case ".java":
      return "java";
    case ".rb":
      return "ruby";
    case ".rs":
      return "rust";
    default:
      return null;
  }
};
