import type { Pool, PoolClient } from 'pg';

export type StudentMatch =
  | { kind: 'found'; studentId: string; registrationNo: string }
  | { kind: 'none' }
  | { kind: 'ambiguous'; count: number };

/**
 * Resolve a registration number to exactly one student.
 * 1. An exact match always wins (the column is UNIQUE).
 * 2. Otherwise a case-insensitive match is accepted only if it is unique — barcodes and typed input
 *    often differ in letter case from what was entered at registration (e.g. "24cs104" vs "24CS104").
 * Leading zeros and every other character are compared exactly; values are never converted to numbers.
 */
export async function resolveStudent(db: Pool | PoolClient, registrationNo: string): Promise<StudentMatch> {
  const exact = await db.query('SELECT student_id, registration_no FROM students WHERE registration_no = $1', [registrationNo]);
  if (exact.rowCount) return { kind: 'found', studentId: exact.rows[0].student_id, registrationNo: exact.rows[0].registration_no };
  const folded = await db.query('SELECT student_id, registration_no FROM students WHERE UPPER(registration_no) = UPPER($1) LIMIT 2', [registrationNo]);
  if (folded.rowCount === 1) return { kind: 'found', studentId: folded.rows[0].student_id, registrationNo: folded.rows[0].registration_no };
  if ((folded.rowCount ?? 0) > 1) return { kind: 'ambiguous', count: folded.rowCount ?? 2 };
  return { kind: 'none' };
}
