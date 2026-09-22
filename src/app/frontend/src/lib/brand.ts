export const disclaimerLong = (entity: string) =>
  `About this demo. ${entity || 'Bricksurance'} is a fictional insurance group and every carrier, ` +
  `policy, claim and figure here is synthetic. The method is an illustrative loss-ratio rate ` +
  `indication — the intent is to show the shape of a governed pricing workflow, not to propose a ` +
  `rate. Every screen reads a real governed Unity Catalog table, view or function.`;

export const disclaimerShort = (entity: string) =>
  `${entity || 'Bricksurance'} is a fictional insurer; all data is synthetic and illustrative.`;
