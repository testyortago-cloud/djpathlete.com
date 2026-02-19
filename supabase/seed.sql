-- Seed: Admin user (password: Admin123!)
insert into public.users (id, email, password_hash, first_name, last_name, role) values
  ('00000000-0000-0000-0000-000000000001', 'admin@djpathlete.com', '$2b$12$WESyL.XRso7rzSEHahgeFuPbXqLl6GsqBKa2RCBiwBkL9Dqi/8kUO', 'Darren', 'Paul', 'admin');

-- Seed: Test clients (password: Admin123!)
insert into public.users (id, email, password_hash, first_name, last_name, role) values
  ('00000000-0000-0000-0000-000000000002', 'marcus@test.com', '$2b$12$WESyL.XRso7rzSEHahgeFuPbXqLl6GsqBKa2RCBiwBkL9Dqi/8kUO', 'Marcus', 'Thompson', 'client'),
  ('00000000-0000-0000-0000-000000000003', 'sarah@test.com', '$2b$12$WESyL.XRso7rzSEHahgeFuPbXqLl6GsqBKa2RCBiwBkL9Dqi/8kUO', 'Sarah', 'Kim', 'client'),
  ('00000000-0000-0000-0000-000000000004', 'james@test.com', '$2b$12$WESyL.XRso7rzSEHahgeFuPbXqLl6GsqBKa2RCBiwBkL9Dqi/8kUO', 'James', 'Rodriguez', 'client');

-- Seed: 20 exercises
insert into public.exercises (name, description, category, muscle_group, difficulty, equipment) values
  ('Barbell Back Squat', 'Compound lower body exercise targeting quads, glutes, and hamstrings', 'strength', 'legs', 'intermediate', 'barbell, squat rack'),
  ('Bench Press', 'Upper body push exercise for chest, shoulders, and triceps', 'strength', 'chest', 'intermediate', 'barbell, bench'),
  ('Deadlift', 'Full body posterior chain exercise', 'strength', 'back', 'advanced', 'barbell'),
  ('Pull-Up', 'Bodyweight pulling exercise for back and biceps', 'strength', 'back', 'intermediate', 'pull-up bar'),
  ('Overhead Press', 'Standing shoulder press for deltoids and triceps', 'strength', 'shoulders', 'intermediate', 'barbell'),
  ('Romanian Deadlift', 'Hamstring-focused hip hinge movement', 'strength', 'legs', 'intermediate', 'barbell'),
  ('Bulgarian Split Squat', 'Unilateral leg exercise for balance and strength', 'strength', 'legs', 'intermediate', 'dumbbells, bench'),
  ('Barbell Row', 'Horizontal pulling exercise for back thickness', 'strength', 'back', 'intermediate', 'barbell'),
  ('Box Jump', 'Explosive lower body plyometric', 'plyometric', 'legs', 'intermediate', 'plyo box'),
  ('Medicine Ball Slam', 'Full body power exercise', 'plyometric', 'full body', 'beginner', 'medicine ball'),
  ('Sprint Intervals', 'High intensity running intervals for conditioning', 'cardio', 'full body', 'advanced', 'none'),
  ('Battle Ropes', 'Upper body and core conditioning', 'cardio', 'arms', 'intermediate', 'battle ropes'),
  ('Kettlebell Swing', 'Hip hinge power exercise', 'strength', 'full body', 'intermediate', 'kettlebell'),
  ('Plank Hold', 'Isometric core stability exercise', 'strength', 'core', 'beginner', 'none'),
  ('Hip Flexor Stretch', 'Static stretch for hip flexors', 'flexibility', 'hips', 'beginner', 'none'),
  ('Foam Rolling - IT Band', 'Self-myofascial release for IT band', 'recovery', 'legs', 'beginner', 'foam roller'),
  ('Agility Ladder Drill', 'Footwork and coordination drill', 'sport_specific', 'legs', 'intermediate', 'agility ladder'),
  ('Cone Drill - 5-10-5', 'Change of direction speed drill', 'sport_specific', 'legs', 'intermediate', 'cones'),
  ('Sled Push', 'Lower body power and conditioning', 'strength', 'legs', 'advanced', 'sled'),
  ('Yoga Flow - Recovery', 'Full body recovery yoga sequence', 'recovery', 'full body', 'beginner', 'yoga mat');

-- Seed: 2 programs
insert into public.programs (id, name, description, category, difficulty, duration_weeks, sessions_per_week, price_cents) values
  ('00000000-0000-0000-0000-000000000101', 'Foundation Strength Program', 'Build a solid strength base with compound movements and progressive overload. Perfect for athletes looking to establish fundamental movement patterns.', 'strength', 'beginner', 8, 3, 9900),
  ('00000000-0000-0000-0000-000000000102', 'Elite Performance Package', 'Advanced training combining strength, power, and sport-specific conditioning for competitive athletes seeking peak performance.', 'hybrid', 'advanced', 12, 5, 34900);
