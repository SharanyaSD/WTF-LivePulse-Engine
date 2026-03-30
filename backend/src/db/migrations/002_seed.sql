-- WTF LivePulse — Seed Data
-- File: 002_seed.sql
-- Idempotent: checks gyms table before running.
-- Generates ~5 000 members, ~270 k historical check-ins, payments, and
-- specific anomaly test scenarios.

DO $$
DECLARE
  -- -------------------------------------------------------------------------
  -- Gym UUIDs (populated after INSERT)
  -- -------------------------------------------------------------------------
  g_lajpat      UUID;
  g_cp          UUID;
  g_bandra      UUID;
  g_powai       UUID;
  g_indiranagar UUID;
  g_koramangala UUID;
  g_banjara     UUID;
  g_noida       UUID;
  g_saltlake    UUID;
  g_velachery   UUID;

  v_count       INTEGER;

  -- -------------------------------------------------------------------------
  -- Indian name arrays
  -- -------------------------------------------------------------------------
  first_names TEXT[] := ARRAY[
    'Aarav','Aditya','Akash','Amit','Ananya','Ankit','Ankur','Anushka','Arjun','Aryan',
    'Deepak','Deepika','Divya','Gaurav','Geeta','Hardik','Harini','Harsh','Ishaan','Isha',
    'Jay','Jyoti','Kabir','Kajal','Karan','Kavya','Kishore','Komal','Kunal','Lakshmi',
    'Manish','Meera','Mohit','Nandini','Neha','Nikhil','Nikita','Nisha','Pankaj','Pooja',
    'Pradeep','Priya','Rahul','Rajeev','Rajesh','Rakesh','Ramya','Ravi','Rohan','Rohit',
    'Sachin','Sahil','Sandeep','Sanjay','Sapna','Shruti','Siddharth','Simran','Sneha','Sonia',
    'Sunil','Suresh','Swati','Tanvi','Tarun','Uday','Usha','Vaibhav','Vandana','Vikas',
    'Vikram','Vinay','Vishal','Yash','Yogesh'
  ];

  last_names TEXT[] := ARRAY[
    'Agarwal','Ahuja','Anand','Arora','Bajaj','Bansal','Batra','Bhatia','Bhatt','Chadha',
    'Chandrasekaran','Chawla','Chopra','Das','Desai','Deshpande','Dubey','Dutta','Gandhi','Garg',
    'Ghosh','Gill','Goswami','Goyal','Gupta','Iyer','Jain','Jha','Joshi','Kapoor',
    'Kaur','Khanna','Khatri','Kumar','Lal','Malhotra','Mehta','Mishra','Mittal','Mukherjee',
    'Nair','Nayak','Pandey','Patel','Patil','Pillai','Prasad','Rao','Reddy','Roy',
    'Sahoo','Saxena','Sen','Seth','Shah','Sharma','Shukla','Singh','Sinha','Srivastava',
    'Thakur','Tiwari','Trivedi','Upadhyay','Varma','Verma','Yadav','Ahire','Bondre','Chavan'
  ];

  -- -------------------------------------------------------------------------
  -- Plan pricing (INR)
  -- -------------------------------------------------------------------------
  monthly_price  NUMERIC := 1499;
  quarterly_price NUMERIC := 3999;
  annual_price   NUMERIC := 11999;

BEGIN
  -- =========================================================================
  -- IDEMPOTENCY CHECK
  -- =========================================================================
  SELECT COUNT(*) INTO v_count FROM gyms;
  IF v_count > 0 THEN
    RAISE NOTICE 'Database already seeded (% gym rows found). Skipping.', v_count;
    RETURN;
  END IF;

  -- =========================================================================
  -- 1. GYMS
  -- =========================================================================
  RAISE NOTICE '[1/8] Inserting gyms...';

  INSERT INTO gyms (id, name, city, capacity, opens_at, closes_at, status) VALUES
    (gen_random_uuid(), 'WTF Gyms — Lajpat Nagar',    'New Delhi',  220, '05:30', '22:30', 'active'),
    (gen_random_uuid(), 'WTF Gyms — Connaught Place',  'New Delhi',  180, '06:00', '22:00', 'active'),
    (gen_random_uuid(), 'WTF Gyms — Bandra West',      'Mumbai',     300, '05:00', '23:00', 'active'),
    (gen_random_uuid(), 'WTF Gyms — Powai',            'Mumbai',     250, '05:30', '22:30', 'active'),
    (gen_random_uuid(), 'WTF Gyms — Indiranagar',      'Bengaluru',  200, '05:30', '22:00', 'active'),
    (gen_random_uuid(), 'WTF Gyms — Koramangala',      'Bengaluru',  180, '06:00', '22:00', 'active'),
    (gen_random_uuid(), 'WTF Gyms — Banjara Hills',    'Hyderabad',  160, '06:00', '22:00', 'active'),
    (gen_random_uuid(), 'WTF Gyms — Sector 18 Noida',  'Noida',      140, '06:00', '21:30', 'active'),
    (gen_random_uuid(), 'WTF Gyms — Salt Lake',        'Kolkata',    120, '06:00', '21:00', 'active'),
    (gen_random_uuid(), 'WTF Gyms — Velachery',        'Chennai',    110, '06:00', '21:00', 'active');

  -- Capture UUIDs
  SELECT id INTO g_lajpat      FROM gyms WHERE name = 'WTF Gyms — Lajpat Nagar';
  SELECT id INTO g_cp           FROM gyms WHERE name = 'WTF Gyms — Connaught Place';
  SELECT id INTO g_bandra       FROM gyms WHERE name = 'WTF Gyms — Bandra West';
  SELECT id INTO g_powai        FROM gyms WHERE name = 'WTF Gyms — Powai';
  SELECT id INTO g_indiranagar  FROM gyms WHERE name = 'WTF Gyms — Indiranagar';
  SELECT id INTO g_koramangala  FROM gyms WHERE name = 'WTF Gyms — Koramangala';
  SELECT id INTO g_banjara      FROM gyms WHERE name = 'WTF Gyms — Banjara Hills';
  SELECT id INTO g_noida        FROM gyms WHERE name = 'WTF Gyms — Sector 18 Noida';
  SELECT id INTO g_saltlake     FROM gyms WHERE name = 'WTF Gyms — Salt Lake';
  SELECT id INTO g_velachery    FROM gyms WHERE name = 'WTF Gyms — Velachery';

  RAISE NOTICE '[1/8] Gyms done.';

  -- =========================================================================
  -- 2. MEMBERS
  -- =========================================================================
  -- Strategy: use a single generate_series pass per gym, deriving all fields
  -- from the series integer (n) so everything is deterministic and fast.
  --
  -- plan_type bucket:
  --   n % 100 < pct_monthly                          => 'monthly'
  --   n % 100 < pct_monthly + pct_quarterly           => 'quarterly'
  --   else                                             => 'annual'
  --
  -- status bucket:
  --   n % 100 < pct_active                            => 'active'
  --   n % 100 < pct_active + 8                        => 'inactive'
  --   else                                             => 'frozen'
  --
  -- joined_at: random day in past 365 days (deterministic via n)
  -- plan_expires_at: joined_at + plan_duration
  -- member_type: n % 5 = 0 => 'renewal', else 'new'
  -- -------------------------------------------------------------------------

  RAISE NOTICE '[2/8] Inserting members...';

  -- Helper: a single INSERT ... SELECT per gym avoids 5 000 individual inserts.
  -- We use a CTE-style SELECT to keep it readable.

  -- ---- Lajpat Nagar: 650, 50/30/20, 88% active ----
  INSERT INTO members (gym_id, name, email, phone, plan_type, member_type, status, joined_at, plan_expires_at)
  SELECT
    g_lajpat,
    (first_names[1 + (n * 7 + 3) % array_length(first_names,1)] || ' ' ||
     last_names [1 + (n * 13 + 5) % array_length(last_names, 1)]) AS name,
    lower(first_names[1 + (n * 7 + 3) % array_length(first_names,1)]) || '.' ||
      lower(last_names[1 + (n * 13 + 5) % array_length(last_names,1)]) ||
      n::TEXT || '@gmail.com',
    '9' || lpad(((5000000000 + n * 9871 + 1234567) % 1000000000)::TEXT, 9, '0'),
    CASE
      WHEN n % 100 < 50 THEN 'monthly'
      WHEN n % 100 < 80 THEN 'quarterly'
      ELSE 'annual'
    END,
    CASE WHEN n % 5 = 0 THEN 'renewal' ELSE 'new' END,
    CASE
      WHEN n % 100 < 88 THEN 'active'
      WHEN n % 100 < 94 THEN 'inactive'
      ELSE 'frozen'
    END,
    NOW() - ((n % 365) || ' days')::INTERVAL - (random() * INTERVAL '12 hours'),
    NOW() - ((n % 365) || ' days')::INTERVAL +
      CASE
        WHEN n % 100 < 50 THEN INTERVAL '30 days'
        WHEN n % 100 < 80 THEN INTERVAL '90 days'
        ELSE                    INTERVAL '365 days'
      END
  FROM generate_series(1, 650) AS n;

  -- ---- Connaught Place: 550, 40/40/20, 85% active ----
  INSERT INTO members (gym_id, name, email, phone, plan_type, member_type, status, joined_at, plan_expires_at)
  SELECT
    g_cp,
    (first_names[1 + (n * 11 + 2) % array_length(first_names,1)] || ' ' ||
     last_names [1 + (n * 17 + 7) % array_length(last_names, 1)]),
    lower(first_names[1 + (n * 11 + 2) % array_length(first_names,1)]) || '.' ||
      lower(last_names[1 + (n * 17 + 7) % array_length(last_names,1)]) ||
      (n + 700)::TEXT || '@gmail.com',
    '9' || lpad(((5000000000 + (n+700) * 9871 + 2345678) % 1000000000)::TEXT, 9, '0'),
    CASE
      WHEN n % 100 < 40 THEN 'monthly'
      WHEN n % 100 < 80 THEN 'quarterly'
      ELSE 'annual'
    END,
    CASE WHEN n % 5 = 0 THEN 'renewal' ELSE 'new' END,
    CASE
      WHEN n % 100 < 85 THEN 'active'
      WHEN n % 100 < 93 THEN 'inactive'
      ELSE 'frozen'
    END,
    NOW() - ((n % 365) || ' days')::INTERVAL - (random() * INTERVAL '12 hours'),
    NOW() - ((n % 365) || ' days')::INTERVAL +
      CASE
        WHEN n % 100 < 40 THEN INTERVAL '30 days'
        WHEN n % 100 < 80 THEN INTERVAL '90 days'
        ELSE                    INTERVAL '365 days'
      END
  FROM generate_series(1, 550) AS n;

  -- ---- Bandra West: 750, 40/40/20, 90% active ----
  INSERT INTO members (gym_id, name, email, phone, plan_type, member_type, status, joined_at, plan_expires_at)
  SELECT
    g_bandra,
    (first_names[1 + (n * 13 + 4) % array_length(first_names,1)] || ' ' ||
     last_names [1 + (n * 19 + 6) % array_length(last_names, 1)]),
    lower(first_names[1 + (n * 13 + 4) % array_length(first_names,1)]) || '.' ||
      lower(last_names[1 + (n * 19 + 6) % array_length(last_names,1)]) ||
      (n + 1300)::TEXT || '@gmail.com',
    '9' || lpad(((5000000000 + (n+1300) * 9871 + 3456789) % 1000000000)::TEXT, 9, '0'),
    CASE
      WHEN n % 100 < 40 THEN 'monthly'
      WHEN n % 100 < 80 THEN 'quarterly'
      ELSE 'annual'
    END,
    CASE WHEN n % 5 = 0 THEN 'renewal' ELSE 'new' END,
    CASE
      WHEN n % 100 < 90 THEN 'active'
      WHEN n % 100 < 96 THEN 'inactive'
      ELSE 'frozen'
    END,
    NOW() - ((n % 365) || ' days')::INTERVAL - (random() * INTERVAL '12 hours'),
    NOW() - ((n % 365) || ' days')::INTERVAL +
      CASE
        WHEN n % 100 < 40 THEN INTERVAL '30 days'
        WHEN n % 100 < 80 THEN INTERVAL '90 days'
        ELSE                    INTERVAL '365 days'
      END
  FROM generate_series(1, 750) AS n;

  -- ---- Powai: 600, 40/40/20, 87% active ----
  INSERT INTO members (gym_id, name, email, phone, plan_type, member_type, status, joined_at, plan_expires_at)
  SELECT
    g_powai,
    (first_names[1 + (n * 17 + 1) % array_length(first_names,1)] || ' ' ||
     last_names [1 + (n * 23 + 9) % array_length(last_names, 1)]),
    lower(first_names[1 + (n * 17 + 1) % array_length(first_names,1)]) || '.' ||
      lower(last_names[1 + (n * 23 + 9) % array_length(last_names,1)]) ||
      (n + 2100)::TEXT || '@gmail.com',
    '9' || lpad(((5000000000 + (n+2100) * 9871 + 4567890) % 1000000000)::TEXT, 9, '0'),
    CASE
      WHEN n % 100 < 40 THEN 'monthly'
      WHEN n % 100 < 80 THEN 'quarterly'
      ELSE 'annual'
    END,
    CASE WHEN n % 5 = 0 THEN 'renewal' ELSE 'new' END,
    CASE
      WHEN n % 100 < 87 THEN 'active'
      WHEN n % 100 < 94 THEN 'inactive'
      ELSE 'frozen'
    END,
    NOW() - ((n % 365) || ' days')::INTERVAL - (random() * INTERVAL '12 hours'),
    NOW() - ((n % 365) || ' days')::INTERVAL +
      CASE
        WHEN n % 100 < 40 THEN INTERVAL '30 days'
        WHEN n % 100 < 80 THEN INTERVAL '90 days'
        ELSE                    INTERVAL '365 days'
      END
  FROM generate_series(1, 600) AS n;

  -- ---- Indiranagar: 550, 40/40/20, 89% active ----
  INSERT INTO members (gym_id, name, email, phone, plan_type, member_type, status, joined_at, plan_expires_at)
  SELECT
    g_indiranagar,
    (first_names[1 + (n * 19 + 8) % array_length(first_names,1)] || ' ' ||
     last_names [1 + (n * 29 + 3) % array_length(last_names, 1)]),
    lower(first_names[1 + (n * 19 + 8) % array_length(first_names,1)]) || '.' ||
      lower(last_names[1 + (n * 29 + 3) % array_length(last_names,1)]) ||
      (n + 2750)::TEXT || '@gmail.com',
    '9' || lpad(((5000000000 + (n+2750) * 9871 + 5678901) % 1000000000)::TEXT, 9, '0'),
    CASE
      WHEN n % 100 < 40 THEN 'monthly'
      WHEN n % 100 < 80 THEN 'quarterly'
      ELSE 'annual'
    END,
    CASE WHEN n % 5 = 0 THEN 'renewal' ELSE 'new' END,
    CASE
      WHEN n % 100 < 89 THEN 'active'
      WHEN n % 100 < 95 THEN 'inactive'
      ELSE 'frozen'
    END,
    NOW() - ((n % 365) || ' days')::INTERVAL - (random() * INTERVAL '12 hours'),
    NOW() - ((n % 365) || ' days')::INTERVAL +
      CASE
        WHEN n % 100 < 40 THEN INTERVAL '30 days'
        WHEN n % 100 < 80 THEN INTERVAL '90 days'
        ELSE                    INTERVAL '365 days'
      END
  FROM generate_series(1, 550) AS n;

  -- ---- Koramangala: 500, 40/40/20, 86% active ----
  INSERT INTO members (gym_id, name, email, phone, plan_type, member_type, status, joined_at, plan_expires_at)
  SELECT
    g_koramangala,
    (first_names[1 + (n * 23 + 6) % array_length(first_names,1)] || ' ' ||
     last_names [1 + (n * 31 + 1) % array_length(last_names, 1)]),
    lower(first_names[1 + (n * 23 + 6) % array_length(first_names,1)]) || '.' ||
      lower(last_names[1 + (n * 31 + 1) % array_length(last_names,1)]) ||
      (n + 3350)::TEXT || '@gmail.com',
    '9' || lpad(((5000000000 + (n+3350) * 9871 + 6789012) % 1000000000)::TEXT, 9, '0'),
    CASE
      WHEN n % 100 < 40 THEN 'monthly'
      WHEN n % 100 < 80 THEN 'quarterly'
      ELSE 'annual'
    END,
    CASE WHEN n % 5 = 0 THEN 'renewal' ELSE 'new' END,
    CASE
      WHEN n % 100 < 86 THEN 'active'
      WHEN n % 100 < 93 THEN 'inactive'
      ELSE 'frozen'
    END,
    NOW() - ((n % 365) || ' days')::INTERVAL - (random() * INTERVAL '12 hours'),
    NOW() - ((n % 365) || ' days')::INTERVAL +
      CASE
        WHEN n % 100 < 40 THEN INTERVAL '30 days'
        WHEN n % 100 < 80 THEN INTERVAL '90 days'
        ELSE                    INTERVAL '365 days'
      END
  FROM generate_series(1, 500) AS n;

  -- ---- Banjara Hills: 450, 50/30/20, 84% active ----
  INSERT INTO members (gym_id, name, email, phone, plan_type, member_type, status, joined_at, plan_expires_at)
  SELECT
    g_banjara,
    (first_names[1 + (n * 29 + 5) % array_length(first_names,1)] || ' ' ||
     last_names [1 + (n * 37 + 2) % array_length(last_names, 1)]),
    lower(first_names[1 + (n * 29 + 5) % array_length(first_names,1)]) || '.' ||
      lower(last_names[1 + (n * 37 + 2) % array_length(last_names,1)]) ||
      (n + 3900)::TEXT || '@gmail.com',
    '9' || lpad(((5000000000 + (n+3900) * 9871 + 7890123) % 1000000000)::TEXT, 9, '0'),
    CASE
      WHEN n % 100 < 50 THEN 'monthly'
      WHEN n % 100 < 80 THEN 'quarterly'
      ELSE 'annual'
    END,
    CASE WHEN n % 5 = 0 THEN 'renewal' ELSE 'new' END,
    CASE
      WHEN n % 100 < 84 THEN 'active'
      WHEN n % 100 < 92 THEN 'inactive'
      ELSE 'frozen'
    END,
    NOW() - ((n % 365) || ' days')::INTERVAL - (random() * INTERVAL '12 hours'),
    NOW() - ((n % 365) || ' days')::INTERVAL +
      CASE
        WHEN n % 100 < 50 THEN INTERVAL '30 days'
        WHEN n % 100 < 80 THEN INTERVAL '90 days'
        ELSE                    INTERVAL '365 days'
      END
  FROM generate_series(1, 450) AS n;

  -- ---- Sector 18 Noida: 400, 60/25/15, 82% active ----
  INSERT INTO members (gym_id, name, email, phone, plan_type, member_type, status, joined_at, plan_expires_at)
  SELECT
    g_noida,
    (first_names[1 + (n * 31 + 3) % array_length(first_names,1)] || ' ' ||
     last_names [1 + (n * 41 + 8) % array_length(last_names, 1)]),
    lower(first_names[1 + (n * 31 + 3) % array_length(first_names,1)]) || '.' ||
      lower(last_names[1 + (n * 41 + 8) % array_length(last_names,1)]) ||
      (n + 4400)::TEXT || '@gmail.com',
    '9' || lpad(((5000000000 + (n+4400) * 9871 + 8901234) % 1000000000)::TEXT, 9, '0'),
    CASE
      WHEN n % 100 < 60 THEN 'monthly'
      WHEN n % 100 < 85 THEN 'quarterly'
      ELSE 'annual'
    END,
    CASE WHEN n % 5 = 0 THEN 'renewal' ELSE 'new' END,
    CASE
      WHEN n % 100 < 82 THEN 'active'
      WHEN n % 100 < 91 THEN 'inactive'
      ELSE 'frozen'
    END,
    NOW() - ((n % 365) || ' days')::INTERVAL - (random() * INTERVAL '12 hours'),
    NOW() - ((n % 365) || ' days')::INTERVAL +
      CASE
        WHEN n % 100 < 60 THEN INTERVAL '30 days'
        WHEN n % 100 < 85 THEN INTERVAL '90 days'
        ELSE                    INTERVAL '365 days'
      END
  FROM generate_series(1, 400) AS n;

  -- ---- Salt Lake: 300, 60/30/10, 80% active ----
  INSERT INTO members (gym_id, name, email, phone, plan_type, member_type, status, joined_at, plan_expires_at)
  SELECT
    g_saltlake,
    (first_names[1 + (n * 37 + 7) % array_length(first_names,1)] || ' ' ||
     last_names [1 + (n * 43 + 4) % array_length(last_names, 1)]),
    lower(first_names[1 + (n * 37 + 7) % array_length(first_names,1)]) || '.' ||
      lower(last_names[1 + (n * 43 + 4) % array_length(last_names,1)]) ||
      (n + 4850)::TEXT || '@gmail.com',
    '9' || lpad(((5000000000 + (n+4850) * 9871 + 9012345) % 1000000000)::TEXT, 9, '0'),
    CASE
      WHEN n % 100 < 60 THEN 'monthly'
      WHEN n % 100 < 90 THEN 'quarterly'
      ELSE 'annual'
    END,
    CASE WHEN n % 5 = 0 THEN 'renewal' ELSE 'new' END,
    CASE
      WHEN n % 100 < 80 THEN 'active'
      WHEN n % 100 < 90 THEN 'inactive'
      ELSE 'frozen'
    END,
    NOW() - ((n % 365) || ' days')::INTERVAL - (random() * INTERVAL '12 hours'),
    NOW() - ((n % 365) || ' days')::INTERVAL +
      CASE
        WHEN n % 100 < 60 THEN INTERVAL '30 days'
        WHEN n % 100 < 90 THEN INTERVAL '90 days'
        ELSE                    INTERVAL '365 days'
      END
  FROM generate_series(1, 300) AS n;

  -- ---- Velachery: 250, 60/30/10, 78% active ----
  INSERT INTO members (gym_id, name, email, phone, plan_type, member_type, status, joined_at, plan_expires_at)
  SELECT
    g_velachery,
    (first_names[1 + (n * 41 + 9) % array_length(first_names,1)] || ' ' ||
     last_names [1 + (n * 47 + 6) % array_length(last_names, 1)]),
    lower(first_names[1 + (n * 41 + 9) % array_length(first_names,1)]) || '.' ||
      lower(last_names[1 + (n * 47 + 6) % array_length(last_names,1)]) ||
      (n + 5200)::TEXT || '@gmail.com',
    '9' || lpad(((5000000000 + (n+5200) * 9871 + 1234598) % 1000000000)::TEXT, 9, '0'),
    CASE
      WHEN n % 100 < 60 THEN 'monthly'
      WHEN n % 100 < 90 THEN 'quarterly'
      ELSE 'annual'
    END,
    CASE WHEN n % 5 = 0 THEN 'renewal' ELSE 'new' END,
    CASE
      WHEN n % 100 < 78 THEN 'active'
      WHEN n % 100 < 89 THEN 'inactive'
      ELSE 'frozen'
    END,
    NOW() - ((n % 365) || ' days')::INTERVAL - (random() * INTERVAL '12 hours'),
    NOW() - ((n % 365) || ' days')::INTERVAL +
      CASE
        WHEN n % 100 < 60 THEN INTERVAL '30 days'
        WHEN n % 100 < 90 THEN INTERVAL '90 days'
        ELSE                    INTERVAL '365 days'
      END
  FROM generate_series(1, 250) AS n;

  RAISE NOTICE '[2/8] Members done.';

  -- =========================================================================
  -- 3. CHURN RISK MEMBERS
  -- =========================================================================
  -- Override last_checkin_at for two cohorts of active members so the
  -- churn-risk dashboard queries return meaningful results.
  -- Cohort A: 150+ active members, last check-in 45-60 days ago
  -- Cohort B: 80+  active members, last check-in >60 days ago
  -- We pick members from the largest gyms to keep it realistic.
  -- =========================================================================

  RAISE NOTICE '[3/8] Applying churn-risk last_checkin_at overrides...';

  -- Cohort A: 45-60 days ago  (pick first 160 active members from Bandra + Powai)
  UPDATE members
  SET    last_checkin_at = NOW() - (47 + (abs(hashtext(id::text))::BIGINT % 13) || ' days')::INTERVAL
  WHERE  id IN (
    SELECT id FROM members
    WHERE  gym_id IN (g_bandra, g_powai) AND status = 'active'
    ORDER BY id
    LIMIT 160
  );

  -- Cohort B: >60 days ago  (pick first 90 active members from Indiranagar + Koramangala)
  UPDATE members
  SET    last_checkin_at = NOW() - (62 + (abs(hashtext(id::text))::BIGINT % 30) || ' days')::INTERVAL
  WHERE  id IN (
    SELECT id FROM members
    WHERE  gym_id IN (g_indiranagar, g_koramangala) AND status = 'active'
    ORDER BY id
    LIMIT 90
  );

  RAISE NOTICE '[3/8] Churn-risk overrides done.';

  -- =========================================================================
  -- 4. HISTORICAL CHECK-INS  (~270 k rows over 90 days)
  -- =========================================================================
  -- For each gym we generate a time-series of check-in slots across 90 days.
  -- We use generate_series on a per-hour grid, then select a random active
  -- member from that gym for each slot using a modulo lookup.
  --
  -- Hourly multiplier encodes the spec traffic pattern:
  --   00-05  => 0.0   (closed / near-zero)
  --   05-06  => 0.60
  --   07-09  => 1.00  (AM peak)
  --   10-11  => 0.40
  --   12-13  => 0.30
  --   14-16  => 0.20
  --   17-20  => 0.90  (PM peak)
  --   21-22  => 0.35
  --   23     => 0.0
  --
  -- Day-of-week multiplier:
  --   0=Sun 0.45, 1=Mon 1.0, 2=Tue 0.95, 3=Wed 0.90, 4=Thu 0.95,
  --   5=Fri 0.85, 6=Sat 0.70
  --
  -- Base visits per gym per hour ~ (member_count * active_pct * 0.15) / 16 open hrs
  -- We simplify: generate one checkin record per "slot" where
  --   slot count per hour = FLOOR(base_rate * hour_mult * dow_mult)
  --
  -- To keep execution time well under 120 s we insert all gyms in a single
  -- batch INSERT...SELECT with a cross-join approach.
  -- =========================================================================

  RAISE NOTICE '[4/8] Inserting historical check-ins (this may take ~60 s)...';

  INSERT INTO checkins (member_id, gym_id, checked_in, checked_out)
  WITH

  -- -------------------------------------------------------------------------
  -- hour_slot: every hour in the past 90 days
  -- -------------------------------------------------------------------------
  hour_slot AS (
    SELECT
      gs                                                        AS slot_time,
      EXTRACT(HOUR FROM gs)::INTEGER                            AS hr,
      EXTRACT(DOW  FROM gs)::INTEGER                            AS dow,
      -- hourly multiplier
      CASE EXTRACT(HOUR FROM gs)::INTEGER
        WHEN 0  THEN 0.00 WHEN 1  THEN 0.00 WHEN 2  THEN 0.00
        WHEN 3  THEN 0.00 WHEN 4  THEN 0.00 WHEN 5  THEN 0.60
        WHEN 6  THEN 0.60 WHEN 7  THEN 1.00 WHEN 8  THEN 1.00
        WHEN 9  THEN 1.00 WHEN 10 THEN 0.40 WHEN 11 THEN 0.40
        WHEN 12 THEN 0.30 WHEN 13 THEN 0.30 WHEN 14 THEN 0.20
        WHEN 15 THEN 0.20 WHEN 16 THEN 0.20 WHEN 17 THEN 0.90
        WHEN 18 THEN 0.90 WHEN 19 THEN 0.90 WHEN 20 THEN 0.90
        WHEN 21 THEN 0.35 WHEN 22 THEN 0.35 ELSE 0.00
      END AS hour_mult,
      -- day-of-week multiplier (0=Sun)
      CASE EXTRACT(DOW FROM gs)::INTEGER
        WHEN 0 THEN 0.45 WHEN 1 THEN 1.00 WHEN 2 THEN 0.95
        WHEN 3 THEN 0.90 WHEN 4 THEN 0.95 WHEN 5 THEN 0.85
        ELSE 0.70
      END AS dow_mult
    FROM generate_series(
      NOW() - INTERVAL '90 days',
      NOW() - INTERVAL '3 hours',          -- exclude last 3 hrs (handled by scenarios)
      INTERVAL '1 hour'
    ) AS gs
  ),

  -- -------------------------------------------------------------------------
  -- gym_config: base visits per hour per gym
  --   base_rate = FLOOR(member_count * active_pct * 0.012)
  --   (empirically gives ~270 k total across 90 days × 10 gyms)
  -- -------------------------------------------------------------------------
  gym_config AS (
    SELECT id AS gym_id, member_count, base_rate
    FROM (VALUES
      -- (gym_id placeholder, member_count, base_rate)
      -- We join on name below; IDs come from gyms table.
      ('WTF Gyms — Lajpat Nagar',    650,  7),
      ('WTF Gyms — Connaught Place',  550,  6),
      ('WTF Gyms — Bandra West',      750,  8),
      ('WTF Gyms — Powai',            600,  6),
      ('WTF Gyms — Indiranagar',      550,  6),
      ('WTF Gyms — Koramangala',      500,  5),
      ('WTF Gyms — Banjara Hills',    450,  4),
      ('WTF Gyms — Sector 18 Noida',  400,  4),
      ('WTF Gyms — Salt Lake',        300,  3),
      ('WTF Gyms — Velachery',        250,  2)
    ) AS t(gym_name, member_count, base_rate)
    JOIN gyms g ON g.name = t.gym_name
  ),

  -- -------------------------------------------------------------------------
  -- slots: cross join gyms × hours, compute per-slot visit count
  -- -------------------------------------------------------------------------
  slots AS (
    SELECT
      gc.gym_id,
      gc.member_count,
      hs.slot_time,
      -- visits this slot (at least 1 if hour is open)
      GREATEST(
        0,
        FLOOR(gc.base_rate * hs.hour_mult * hs.dow_mult)::INTEGER
      ) AS visits
    FROM gym_config gc
    CROSS JOIN hour_slot hs
    WHERE hs.hour_mult > 0
  ),

  -- -------------------------------------------------------------------------
  -- expanded: one row per visit (slots with visits > 0, repeated)
  -- -------------------------------------------------------------------------
  expanded AS (
    SELECT
      s.gym_id,
      s.member_count,
      s.slot_time,
      v.visit_num
    FROM slots s
    CROSS JOIN LATERAL generate_series(1, s.visits) AS v(visit_num)
    WHERE s.visits > 0
  ),

  -- -------------------------------------------------------------------------
  -- member_lookup: numbered active members per gym (for modulo selection)
  -- -------------------------------------------------------------------------
  member_lookup AS (
    SELECT
      gym_id,
      id   AS member_id,
      ROW_NUMBER() OVER (PARTITION BY gym_id ORDER BY id) - 1 AS rn
    FROM members
    WHERE status = 'active'
  ),

  -- -------------------------------------------------------------------------
  -- active_counts: total active members per gym
  -- -------------------------------------------------------------------------
  active_counts AS (
    SELECT gym_id, COUNT(*) AS active_count
    FROM members WHERE status = 'active'
    GROUP BY gym_id
  ),

  -- -------------------------------------------------------------------------
  -- final: pair each visit slot with a member
  -- -------------------------------------------------------------------------
  final AS (
    SELECT
      ml.member_id,
      e.gym_id,
      -- spread check-in within the hour using visit_num as offset (minutes)
      e.slot_time + ((e.visit_num * 7 + 3) % 55 || ' minutes')::INTERVAL AS checked_in,
      -- checkout 45-90 minutes after check-in
      e.slot_time + ((e.visit_num * 7 + 3) % 55 || ' minutes')::INTERVAL
        + (45 + (e.visit_num * 13) % 46 || ' minutes')::INTERVAL          AS checked_out
    FROM expanded e
    JOIN active_counts ac ON ac.gym_id = e.gym_id
    JOIN member_lookup ml
      ON ml.gym_id = e.gym_id
      AND ml.rn = ((e.visit_num * 31 + EXTRACT(EPOCH FROM e.slot_time)::BIGINT) % ac.active_count)
  )

  SELECT member_id, gym_id, checked_in, checked_out FROM final;

  RAISE NOTICE '[4/8] Historical check-ins done.';

  -- =========================================================================
  -- 5. UPDATE members.last_checkin_at FROM actual checkins
  --    (for all members not already overridden by churn-risk step)
  -- =========================================================================

  RAISE NOTICE '[5/8] Updating last_checkin_at from checkin history...';

  UPDATE members m
  SET    last_checkin_at = sub.latest
  FROM (
    SELECT member_id, MAX(checked_in) AS latest
    FROM   checkins
    GROUP  BY member_id
  ) sub
  WHERE  m.id = sub.member_id
    AND  (m.last_checkin_at IS NULL OR m.last_checkin_at > NOW() - INTERVAL '44 days');
  -- Do NOT overwrite the churn-risk overrides (those are < 44 days boundary)

  RAISE NOTICE '[5/8] last_checkin_at update done.';

  -- =========================================================================
  -- 6. ANOMALY TEST SCENARIOS
  -- =========================================================================

  RAISE NOTICE '[6/8] Inserting anomaly test scenarios...';

  -- -------------------------------------------------------------------------
  -- 6a. VELACHERY — zero_checkins scenario
  --     Requirement: NO open check-ins, last checkin > 2 hrs ago
  --
  --     Action: delete any lingering open check-ins, ensure last closed
  --             check-in is 3 hrs ago, update member.last_checkin_at.
  -- -------------------------------------------------------------------------

  -- Remove any open check-ins for Velachery (safety net)
  DELETE FROM checkins
  WHERE  gym_id = g_velachery AND checked_out IS NULL;

  -- Insert a single closed check-in 3 hours ago so last_checkin query works
  INSERT INTO checkins (member_id, gym_id, checked_in, checked_out)
  SELECT
    m.id,
    g_velachery,
    NOW() - INTERVAL '3 hours',
    NOW() - INTERVAL '2 hours 10 minutes'
  FROM members m
  WHERE m.gym_id = g_velachery AND m.status = 'active'
  ORDER BY m.id
  LIMIT 1;

  -- Sync last_checkin_at for Velachery members
  UPDATE members m
  SET    last_checkin_at = NOW() - INTERVAL '3 hours'
  WHERE  m.gym_id = g_velachery
    AND  m.status = 'active'
    AND  m.id = (
      SELECT id FROM members
      WHERE gym_id = g_velachery AND status = 'active'
      ORDER BY id LIMIT 1
    );

  -- -------------------------------------------------------------------------
  -- 6b. BANDRA WEST — capacity_breach scenario
  --     Requirement: 280 open check-ins (checked_out IS NULL)
  --     Bandra capacity = 300, so 280 = ~93% → triggers critical alert
  --
  --     Insert 280 open check-ins from 30 minutes ago.
  -- -------------------------------------------------------------------------

  INSERT INTO checkins (member_id, gym_id, checked_in, checked_out)
  SELECT
    m.id,
    g_bandra,
    NOW() - INTERVAL '30 minutes',
    NULL
  FROM (
    SELECT id FROM members
    WHERE  gym_id = g_bandra AND status = 'active'
    ORDER BY id
    LIMIT 280
  ) m;

  -- Update last_checkin_at for those members
  UPDATE members
  SET    last_checkin_at = NOW() - INTERVAL '30 minutes'
  WHERE  gym_id = g_bandra
    AND  status = 'active'
    AND  id IN (
      SELECT id FROM members
      WHERE gym_id = g_bandra AND status = 'active'
      ORDER BY id
      LIMIT 280
    );

  -- -------------------------------------------------------------------------
  -- 6c. SALT LAKE — revenue_drop scenario
  --     Requirement:
  --       Last week same-day payments >= 15 000 INR
  --       Today payments <= 3 000 INR
  --
  --     We INSERT synthetic payments directly (not tied to normal payment
  --     flow) to guarantee the exact amounts.
  --     Use the first active member of Salt Lake as a proxy payer.
  -- -------------------------------------------------------------------------

  -- Last-week same-day: insert 12 × 1499 = 17988 INR  (well above 15000)
  INSERT INTO payments (member_id, gym_id, amount, plan_type, payment_type, paid_at, notes)
  SELECT
    m.id,
    g_saltlake,
    1499,
    'monthly',
    'renewal',
    (NOW() - INTERVAL '7 days')::DATE + INTERVAL '9 hours' + (v * INTERVAL '5 minutes'),
    'revenue_drop_scenario_lastweek'
  FROM (
    SELECT id FROM members WHERE gym_id = g_saltlake AND status = 'active' ORDER BY id LIMIT 1
  ) m
  CROSS JOIN generate_series(0, 11) AS v;

  -- Today: insert 1 × 1499 = 1499 INR  (well below 3000)
  INSERT INTO payments (member_id, gym_id, amount, plan_type, payment_type, paid_at, notes)
  SELECT
    m.id,
    g_saltlake,
    1499,
    'monthly',
    'new',
    NOW() - INTERVAL '1 hour',
    'revenue_drop_scenario_today'
  FROM (
    SELECT id FROM members WHERE gym_id = g_saltlake AND status = 'active' ORDER BY id LIMIT 1
  ) m;

  RAISE NOTICE '[6/8] Anomaly scenarios done.';

  -- =========================================================================
  -- 7. PAYMENTS  (normal member payments)
  -- =========================================================================
  -- Every member: 1 payment at joined_at ± 5 min
  -- Renewal members (member_type='renewal'): extra payment 30/90/365 days later
  -- =========================================================================

  RAISE NOTICE '[7/8] Inserting member payments...';

  -- First payment for all members
  INSERT INTO payments (member_id, gym_id, amount, plan_type, payment_type, paid_at)
  SELECT
    m.id,
    m.gym_id,
    CASE m.plan_type
      WHEN 'monthly'   THEN 1499
      WHEN 'quarterly' THEN 3999
      ELSE                  11999
    END,
    m.plan_type,
    m.member_type,
    m.joined_at + ((abs(hashtext(m.id::text))::BIGINT % 10) - 5 || ' minutes')::INTERVAL
  FROM members m;

  -- Renewal second payment (plan duration after first payment)
  INSERT INTO payments (member_id, gym_id, amount, plan_type, payment_type, paid_at)
  SELECT
    m.id,
    m.gym_id,
    CASE m.plan_type
      WHEN 'monthly'   THEN 1499
      WHEN 'quarterly' THEN 3999
      ELSE                  11999
    END,
    m.plan_type,
    'renewal',
    m.joined_at +
      CASE m.plan_type
        WHEN 'monthly'   THEN INTERVAL '30 days'
        WHEN 'quarterly' THEN INTERVAL '90 days'
        ELSE                  INTERVAL '365 days'
      END
      + ((abs(hashtext(m.id::text))::BIGINT % 10) - 5 || ' minutes')::INTERVAL
  FROM members m
  WHERE m.member_type = 'renewal';

  RAISE NOTICE '[7/8] Payments done.';

  -- =========================================================================
  -- 8. REFRESH MATERIALIZED VIEW
  -- =========================================================================

  RAISE NOTICE '[8/8] Refreshing gym_hourly_stats materialized view...';
  REFRESH MATERIALIZED VIEW gym_hourly_stats;
  RAISE NOTICE '[8/8] Materialized view refreshed.';

  RAISE NOTICE '========================================================';
  RAISE NOTICE 'WTF LivePulse seed complete.';
  RAISE NOTICE '  Gyms    : 10';
  RAISE NOTICE '  Members : ~5 000';
  RAISE NOTICE '  Checkins: see checkins table for exact count';
  RAISE NOTICE '  Payments: see payments table for exact count';
  RAISE NOTICE '  Scenarios:';
  RAISE NOTICE '    Velachery   -> zero_checkins alert (no open CI, last CI 3h ago)';
  RAISE NOTICE '    Bandra West -> capacity_breach alert (280 open CIs / cap 300)';
  RAISE NOTICE '    Salt Lake   -> revenue_drop alert (18k last week vs 1.5k today)';
  RAISE NOTICE '========================================================';

END;
$$ LANGUAGE plpgsql;
