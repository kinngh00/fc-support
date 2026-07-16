import { db } from "./database.mjs";

const insertLog = db.prepare(`
  INSERT INTO backend_logs (created_at, level, component, message, details_json)
  VALUES (?, ?, ?, ?, ?)
`);

function write(level, component, message, details = null) {
  const createdAt = new Date().toISOString();
  const normalizedDetails = details == null ? null : JSON.stringify(details);
  insertLog.run(createdAt, level, component, message, normalizedDetails);
  const suffix = details == null ? "" : ` ${JSON.stringify(details)}`;
  const line = `[${createdAt}] [${level}] [${component}] ${message}${suffix}`;
  if (level === "오류") console.error(line);
  else if (level === "경고") console.warn(line);
  else console.log(line);

  db.prepare(`
    DELETE FROM backend_logs
    WHERE id NOT IN (SELECT id FROM backend_logs ORDER BY id DESC LIMIT 5000)
  `).run();
}

export const logger = {
  info(component, message, details) { write("정보", component, message, details); },
  success(component, message, details) { write("성공", component, message, details); },
  warn(component, message, details) { write("경고", component, message, details); },
  error(component, message, details) { write("오류", component, message, details); },
};

export function listLogs(limit = 200, afterId = 0) {
  const rows = db.prepare(`
    SELECT id, created_at, level, component, message, details_json
    FROM backend_logs
    WHERE id > ?
    ORDER BY id DESC
    LIMIT ?
  `).all(afterId, limit);
  return rows.map((row) => ({
    id: Number(row.id),
    createdAt: row.created_at,
    level: row.level,
    component: row.component,
    message: row.message,
    details: row.details_json ? JSON.parse(row.details_json) : null,
  }));
}
