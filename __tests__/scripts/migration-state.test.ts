import { describe, it, expect } from "vitest"
import {
  dynamicDdlFiles,
  findDrift,
  maskComments,
  normalizeCode,
  qualify,
  readMigrationState,
  type LiveState,
} from "@/scripts/lib/migration-state"

const BODY_V1 = `
DECLARE
  n integer;
BEGIN
  -- count them
  SELECT count(*) INTO n FROM public.t;
  RETURN n;
END;
`

const BODY_V2 = `
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM public.t;
  IF n = 0 THEN RAISE EXCEPTION 'empty'; END IF;
  RETURN n;
END;
`

const fnSql = (body: string, extra = "") => `
-- header comment: CREATE OR REPLACE FUNCTION public.decoy() is only a comment
CREATE OR REPLACE FUNCTION public.count_t()
RETURNS integer LANGUAGE plpgsql ${extra}
AS $function$${body}$function$;
`

const empty: LiveState = { functions: [], tables: [], policies: [] }

describe("normalizeCode", () => {
  it("treats bodies that differ only in comments and layout as the same code", () => {
    const stripped = BODY_V1.replace("  -- count them\n", "").replace(/\n\s+/g, "\n")
    expect(normalizeCode(stripped)).toBe(normalizeCode(BODY_V1))
  })

  it("keeps a real code change visible", () => {
    expect(normalizeCode(BODY_V2)).not.toBe(normalizeCode(BODY_V1))
  })

  it("does not treat -- inside a string literal as a comment", () => {
    expect(normalizeCode(`SELECT 'a -- b';`)).toBe(`SELECT 'a -- b';`)
    expect(normalizeCode(`SELECT 'a -- b';`)).not.toBe(normalizeCode(`SELECT 'a ';`))
  })

  it("keeps a nested dollar-quoted string byte for byte, since it may be data", () => {
    expect(normalizeCode(`x := $t$a -- b$t$;`)).toBe(`x := $t$a -- b$t$;`)
    expect(normalizeCode(`x := $t$a -- b$t$;`)).not.toBe(normalizeCode(`x := $t$a $t$;`))
  })

  it("keeps whitespace inside a string literal", () => {
    expect(normalizeCode(`SELECT 'a  b';`)).not.toBe(normalizeCode(`SELECT 'a b';`))
  })

  it("reads an E'' string's backslash escape, so a quote inside it does not end it", () => {
    const one = `x := E'it\\'s -- x'; RETURN 1;`
    const two = `x := E'it\\'s -- x'; RETURN 2;`
    expect(normalizeCode(one)).not.toBe(normalizeCode(two))
  })

  it("does not treat -- inside a quoted identifier as a comment", () => {
    expect(normalizeCode(`SELECT "a--b" FROM t;`)).toBe(`SELECT "a--b" FROM t;`)
  })
})

describe("dynamicDdlFiles", () => {
  it("finds a file that builds RLS or policy DDL for EXECUTE, and not one that only mentions it", () => {
    const files = [
      { name: "a.sql", sql: `DO $$ BEGIN EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t); END $$;` },
      { name: "b.sql", sql: `DO $$ BEGIN EXECUTE 'CREATE POLICY p ON t USING (true)'; END $$;` },
      { name: "c.sql", sql: `-- EXECUTE format('ALTER TABLE x ENABLE ROW LEVEL SECURITY')\nALTER TABLE x ENABLE ROW LEVEL SECURITY;` },
      { name: "d.sql", sql: `DO $$ BEGIN EXECUTE format('REVOKE ALL ON %I FROM anon', t); END $$;` },
    ]
    expect(dynamicDdlFiles(files)).toEqual(["a.sql", "b.sql"])
  })
})

describe("maskComments", () => {
  it("keeps offsets and blanks only comments", () => {
    const sql = `SELECT 1; -- gone\nSELECT '--kept'; /* gone */`
    const masked = maskComments(sql)
    expect(masked).toHaveLength(sql.length)
    expect(masked).not.toContain("gone")
    expect(masked).toContain("'--kept'")
  })
})

describe("qualify", () => {
  it("defaults to public and unquotes", () => {
    expect(qualify("pipelines")).toBe("public.pipelines")
    expect(qualify("Public.Pipelines")).toBe("public.pipelines")
    expect(qualify('realtime."messages"')).toBe("realtime.messages")
  })
})

describe("readMigrationState", () => {
  it("takes the LAST definition of a function, ignoring one that is only in a comment", () => {
    const s = readMigrationState([
      { name: "001_a.sql", sql: fnSql(BODY_V1) },
      { name: "002_b.sql", sql: fnSql(BODY_V2, "SECURITY DEFINER") },
    ])
    expect([...s.functions.keys()]).toEqual(["public.count_t"])
    expect(s.functions.get("public.count_t")).toEqual({ file: "002_b.sql", body: BODY_V2, securityDefiner: true })
  })

  it("reads SECURITY DEFINER written after the body", () => {
    const s = readMigrationState([
      {
        name: "001_a.sql",
        sql: `CREATE FUNCTION f() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql SECURITY DEFINER;\nCREATE FUNCTION g() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;`,
      },
    ])
    expect(s.functions.get("public.f")?.securityDefiner).toBe(true)
    expect(s.functions.get("public.g")?.securityDefiner).toBe(false)
  })

  it("forgets a function a later migration drops", () => {
    const s = readMigrationState([
      { name: "001_a.sql", sql: fnSql(BODY_V1) },
      { name: "002_b.sql", sql: "DROP FUNCTION IF EXISTS public.count_t();" },
    ])
    expect(s.functions.size).toBe(0)
  })

  it("replays RLS and policies in order, including drops and quoted names", () => {
    const s = readMigrationState([
      {
        name: "001_a.sql",
        sql: `ALTER TABLE public.p ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on p" ON public.p FOR ALL TO service_role USING (true);
CREATE POLICY old_one ON p FOR SELECT USING (true);
-- CREATE POLICY "commented out" ON public.p USING (true);`,
      },
      { name: "002_b.sql", sql: `DROP POLICY IF EXISTS old_one ON public.p;\nALTER TABLE ONLY q DISABLE ROW LEVEL SECURITY;` },
    ])
    expect(s.rls.get("public.p")).toEqual({ file: "001_a.sql", enabled: true })
    expect(s.rls.get("public.q")).toEqual({ file: "002_b.sql", enabled: false })
    expect([...s.policies.keys()]).toEqual(["public.p|Service role full access on p"])
  })

  it("does not read table statements that sit inside a function body", () => {
    const s = readMigrationState([
      {
        name: "001_a.sql",
        sql: `CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN ALTER TABLE x ENABLE ROW LEVEL SECURITY; END; $$;`,
      },
    ])
    expect(s.rls.size).toBe(0)
  })

  it("adds declared dynamic RLS as the file's last word, where the replay cannot read it", () => {
    const files = [
      { name: "001_a.sql", sql: `ALTER TABLE t DISABLE ROW LEVEL SECURITY;` },
      { name: "002_b.sql", sql: `DO $$ BEGIN EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', 't'); END $$;` },
    ]
    expect(readMigrationState(files).rls.get("public.t")).toEqual({ file: "001_a.sql", enabled: false })
    expect(readMigrationState(files, { "002_b.sql": { rlsEnabled: ["t"] } }).rls.get("public.t")).toEqual({
      file: "002_b.sql",
      enabled: true,
    })
  })

  it("drops a table's policies and RLS flag with DROP TABLE", () => {
    const s = readMigrationState([
      { name: "001_a.sql", sql: `ALTER TABLE t ENABLE ROW LEVEL SECURITY;\nCREATE POLICY a ON t USING (true);` },
      { name: "002_b.sql", sql: `DROP TABLE IF EXISTS public.t;` },
    ])
    expect(s.rls.size).toBe(0)
    expect(s.policies.size).toBe(0)
  })
})

describe("findDrift", () => {
  const expected = readMigrationState([
    {
      name: "001_a.sql",
      sql: `${fnSql(BODY_V2, "SECURITY DEFINER")}
ALTER TABLE public.p ENABLE ROW LEVEL SECURITY;
CREATE POLICY "svc" ON public.p FOR ALL TO service_role USING (true);
CREATE POLICY "chan" ON realtime.messages FOR SELECT USING (true);`,
    },
  ])
  const matching: LiveState = {
    // Comments stripped and re-indented, the way the dev clone holds several bodies.
    functions: [{ schema: "public", name: "count_t", src: normalizeCode(BODY_V2), securityDefiner: true }],
    tables: [
      { schema: "public", name: "p", rlsEnabled: true },
      { schema: "realtime", name: "messages", rlsEnabled: true },
    ],
    policies: [
      { schema: "public", table: "p", name: "svc" },
      { schema: "realtime", table: "messages", name: "chan" },
    ],
  }

  it("finds nothing when only comments and layout differ", () => {
    expect(findDrift(expected, matching)).toEqual([])
  })

  it("reports the G46 shapes: an older body, RLS off and a missing policy", () => {
    const live: LiveState = {
      ...matching,
      functions: [{ schema: "public", name: "count_t", src: BODY_V1, securityDefiner: true }],
      tables: [{ schema: "public", name: "p", rlsEnabled: false }, matching.tables[1]],
      policies: [matching.policies[1]],
    }
    expect(findDrift(expected, live)).toEqual([
      { kind: "function_code_differs", object: "public.count_t", file: "001_a.sql" },
      { kind: "rls_differs", object: "public.p", file: "001_a.sql", expected: "on" },
      { kind: "policy_missing", object: "public.p|svc", file: "001_a.sql" },
    ])
  })

  it("reports a function that lost SECURITY DEFINER", () => {
    const live: LiveState = { ...matching, functions: [{ ...matching.functions[0], securityDefiner: false }] }
    expect(findDrift(expected, live)).toEqual([
      { kind: "function_security_differs", object: "public.count_t", file: "001_a.sql", expected: "definer" },
    ])
  })

  it("accepts a match on any overload of the name", () => {
    const live: LiveState = {
      ...matching,
      functions: [{ ...matching.functions[0], src: "BEGIN END;" }, matching.functions[0]],
    }
    expect(findDrift(expected, live)).toEqual([])
  })

  it("reports a missing function and a missing table once, not once per policy", () => {
    expect(findDrift(expected, empty)).toEqual([
      { kind: "function_missing", object: "public.count_t", file: "001_a.sql" },
      { kind: "table_missing", object: "public.p", file: "001_a.sql" },
      { kind: "table_missing", object: "realtime.messages", file: "001_a.sql" },
    ])
  })
})
