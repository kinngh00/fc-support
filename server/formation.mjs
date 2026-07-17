const formationLines = [
  new Set(["SW", "LWB", "LB", "LCB", "CB", "RCB", "RB", "RWB"]),
  new Set(["LDM", "CDM", "RDM"]),
  new Set(["LM", "LCM", "CM", "RCM", "RM"]),
  new Set(["LAM", "CAM", "RAM"]),
  new Set(["LW", "LF", "CF", "RF", "RW", "LS", "ST", "RS"]),
];

export function inferFormation(positions = []) {
  const counts = formationLines.map((line) => positions.reduce(
    (count, position) => count + (line.has(String(position || "").toUpperCase()) ? 1 : 0),
    0,
  ));
  const occupiedLines = counts.filter((count) => count > 0);
  return occupiedLines.length > 0 ? occupiedLines.join("-") : null;
}
