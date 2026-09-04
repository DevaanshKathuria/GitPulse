export interface PrometheusSample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

const samplePattern =
  /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+([^\s]+)(?:\s+\d+)?$/;
const labelPattern = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"])*)"/g;

const parseLabels = (input: string | undefined): Record<string, string> => {
  if (input === undefined || input.length === 0) {
    return {};
  }

  const labels: Record<string, string> = {};

  for (const match of input.matchAll(labelPattern)) {
    labels[match[1]] = match[2]
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }

  return labels;
};

export const parsePrometheusMetrics = (input: string): PrometheusSample[] => {
  const samples: PrometheusSample[] = [];

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const match = line.match(samplePattern);
    if (match === null) {
      continue;
    }

    const value = Number(match[3]);
    if (Number.isNaN(value)) {
      continue;
    }

    samples.push({
      name: match[1],
      labels: parseLabels(match[2]),
      value
    });
  }

  return samples;
};

export const findMetric = (
  samples: PrometheusSample[],
  name: string,
  labels?: Record<string, string>
): number | undefined => {
  return samples.find(
    (sample) =>
      sample.name === name &&
      (labels === undefined ||
        Object.entries(labels).every(([key, value]) => sample.labels[key] === value))
  )?.value;
};

export const sumMetric = (
  samples: PrometheusSample[],
  name: string
): number => {
  return samples
    .filter((sample) => sample.name === name && Number.isFinite(sample.value))
    .reduce((total, sample) => total + sample.value, 0);
};
