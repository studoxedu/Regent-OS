const https = require('https');
const PAT = process.env.SUPABASE_PAT;
const PROJECT_REF = 'fghdgtihpvaehykgqgro';
const SCHOOL_ID = '00000000-0000-0000-0000-000000000003';

function sql(q) {
  return new Promise((res,rej) => {
    const body = JSON.stringify({query:q});
    const req = https.request({hostname:'api.supabase.com',path:`/v1/projects/${PROJECT_REF}/database/query`,method:'POST',headers:{'Authorization':`Bearer ${PAT}`,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},r=>{
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{try{res(JSON.parse(d))}catch{res({raw:d})}});
    });
    req.on('error',rej); req.write(body); req.end();
  });
}
function ok(r,s){if(r&&r.error){console.error(`FAIL[${s}]:`,r.error);process.exit(1);}console.log('   OK');}

async function run() {
  console.log('Phase 5 — Schedox\n');

  console.log('1. venues table…');
  ok(await sql(`
    CREATE TABLE IF NOT EXISTS venues (
      id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      institution_id UUID        NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      name           TEXT        NOT NULL,
      capacity       INTEGER,
      venue_type     TEXT        NOT NULL DEFAULT 'classroom'
                                 CHECK (venue_type IN ('classroom','lab','hall','outdoor','office')),
      is_active      BOOLEAN     NOT NULL DEFAULT true,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='venues' AND policyname='venues_auth') THEN
        CREATE POLICY venues_auth ON venues FOR ALL TO authenticated USING (true) WITH CHECK (true);
      END IF;
    END $$;
  `),'venues');

  console.log('2. timetable_entries table…');
  ok(await sql(`
    CREATE TABLE IF NOT EXISTS timetable_entries (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      semester_id  UUID        NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
      offering_id  UUID        NOT NULL REFERENCES course_offerings(id) ON DELETE CASCADE,
      venue_id     UUID        REFERENCES venues(id),
      day_of_week  INTEGER     NOT NULL CHECK (day_of_week BETWEEN 1 AND 5),
      start_time   TIME        NOT NULL,
      end_time     TIME        NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (semester_id, offering_id, day_of_week, start_time)
    );
    ALTER TABLE timetable_entries ENABLE ROW LEVEL SECURITY;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='timetable_entries' AND policyname='te_auth') THEN
        CREATE POLICY te_auth ON timetable_entries FOR ALL TO authenticated USING (true) WITH CHECK (true);
      END IF;
    END $$;
  `),'timetable_entries');

  console.log('3. exam_entries table…');
  ok(await sql(`
    CREATE TABLE IF NOT EXISTS exam_entries (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      semester_id  UUID        NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
      offering_id  UUID        NOT NULL REFERENCES course_offerings(id) ON DELETE CASCADE,
      venue_id     UUID        REFERENCES venues(id),
      exam_date    DATE        NOT NULL,
      start_time   TIME        NOT NULL,
      end_time     TIME        NOT NULL,
      notes        TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE exam_entries ENABLE ROW LEVEL SECURITY;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='exam_entries' AND policyname='ee_auth') THEN
        CREATE POLICY ee_auth ON exam_entries FOR ALL TO authenticated USING (true) WITH CHECK (true);
      END IF;
    END $$;
  `),'exam_entries');

  console.log('4. Seeding a test venue for Regentos Polytechnic…');
  ok(await sql(`
    INSERT INTO venues (institution_id, name, capacity, venue_type)
    VALUES ('${SCHOOL_ID}', 'LT 1 — Main Lecture Theatre', 200, 'hall'),
           ('${SCHOOL_ID}', 'Room 101', 40, 'classroom'),
           ('${SCHOOL_ID}', 'Computer Lab A', 30, 'lab')
    ON CONFLICT DO NOTHING;
  `),'seed venues');

  console.log('\nPhase 5 Schedox complete.');
}
run().catch(e=>{console.error(e);process.exit(1);});
