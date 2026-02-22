export const EXERCISE_TEMPLATE_CSV = `name,category,difficulty,muscle_group,equipment,description,instructions,video_url,movement_pattern,primary_muscles,secondary_muscles,force_type,laterality,equipment_required,is_bodyweight,is_compound
Barbell Back Squat,strength,intermediate,Quadriceps / Glutes,Barbell / Squat Rack,Compound lower body movement targeting quads and glutes,"1. Set bar on upper traps. 2. Unrack and step back. 3. Brace core, squat to parallel. 4. Drive through heels to stand.",,squat,quadriceps|glutes,hamstrings|core,push,bilateral,barbell|squat_rack,false,true
Romanian Deadlift,strength,intermediate,Hamstrings / Glutes,Barbell,Hip hinge targeting posterior chain,"1. Hold barbell at hip height. 2. Push hips back, lowering bar along shins. 3. Feel stretch in hamstrings. 4. Drive hips forward to stand.",,hinge,hamstrings|glutes,lower_back|core,pull,bilateral,barbell,false,true
Dumbbell Bench Press,strength,beginner,Chest / Triceps,Dumbbells / Bench,Horizontal pressing movement for chest development,"1. Lie on bench holding dumbbells above chest. 2. Lower to chest level. 3. Press up to full extension.",,push,chest|triceps,shoulders,push,bilateral,dumbbell|bench,false,true
Pull-Up,strength,intermediate,Lats / Biceps,Pull-up Bar,Vertical pulling bodyweight exercise,"1. Hang from bar with overhand grip. 2. Pull chin above bar. 3. Lower with control.",,pull,lats|biceps,upper_back|forearms,pull,bilateral,pull_up_bar,true,true
Bulgarian Split Squat,strength,intermediate,Quadriceps / Glutes,Dumbbells / Bench,Single-leg squat variation for unilateral strength,"1. Rear foot elevated on bench. 2. Lower until front thigh is parallel. 3. Drive through front heel to stand.",,lunge,quadriceps|glutes,hamstrings|core,push,unilateral,dumbbell|bench,false,true
Farmer's Walk,strength,beginner,Forearms / Core,Dumbbells / Kettlebells,Loaded carry for grip and core stability,"1. Pick up heavy weights in each hand. 2. Stand tall, shoulders back. 3. Walk with controlled steps for prescribed distance.",,carry,forearms|core,traps|shoulders,static,bilateral,dumbbell,false,true
Pallof Press,strength,beginner,Core / Obliques,Cable Machine,Anti-rotation exercise for core stability,"1. Stand sideways to cable at chest height. 2. Hold handle at chest. 3. Press arms straight out, resisting rotation. 4. Return to chest.",,rotation,core|obliques,,static,bilateral,cable_machine,false,false
Plank,strength,beginner,Core,None,Isometric core stabilization exercise,"1. Forearms on floor, body in straight line. 2. Brace core, squeeze glutes. 3. Hold for prescribed duration.",,isometric,core,shoulders|glutes,static,bilateral,,true,false
Treadmill Run,cardio,beginner,Full Body,Treadmill,Steady-state or interval cardiovascular training,"1. Set desired speed and incline. 2. Maintain upright posture. 3. Swing arms naturally.",,locomotion,quadriceps|hamstrings|calves,core|hip_flexors,dynamic,bilateral,treadmill,false,true
Kettlebell Swing,strength|cardio,intermediate,Full Body,Kettlebell,Hip hinge power exercise with cardiovascular demand,"1. Hinge at hips, swing kettlebell back. 2. Drive hips forward explosively. 3. Swing to chest height.",,hinge,glutes|hamstrings,core|shoulders,dynamic,bilateral,kettlebell,false,true
Lateral Band Walk,strength,beginner,Glutes / Abductors,Resistance Band,Activation exercise for hip abductors and glute medius,"1. Place band above knees. 2. Slight squat position. 3. Step laterally with control. 4. Maintain tension throughout.",,locomotion,abductors|glutes,core,dynamic,alternating,resistance_band,false,false`

export const EXERCISE_RELATIONSHIPS_TEMPLATE_CSV = `exercise_name,related_exercise_name,relationship_type,notes
Barbell Back Squat,Goblet Squat,regression,Simpler squat pattern for beginners learning mechanics
Barbell Back Squat,Front Squat,variation,Shifts emphasis to quads and upper back
Barbell Back Squat,Bulgarian Split Squat,alternative,Unilateral option when barbell squatting is contraindicated
Goblet Squat,Barbell Back Squat,progression,Progress to barbell once goblet form is solid
Romanian Deadlift,Single-Leg Romanian Deadlift,progression,Unilateral progression for balance and stability
Romanian Deadlift,Good Morning,variation,Similar hinge pattern with bar on back
Dumbbell Bench Press,Push-Up,regression,Bodyweight alternative for beginners
Dumbbell Bench Press,Barbell Bench Press,progression,Higher loading potential with barbell
Pull-Up,Lat Pulldown,regression,Machine alternative when pull-ups are too difficult
Pull-Up,Chin-Up,variation,Supinated grip shifts emphasis to biceps
Plank,Dead Bug,regression,Supine anti-extension for beginners
Plank,Ab Wheel Rollout,progression,Dynamic anti-extension with greater demand`
