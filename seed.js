const { init, run, all } = require('./db');

const exams = [
  {
    title: 'Math',
    description: 'Basic math exam',
    sections: [
      {
        title: 'Algebra',
        questions: [
          {
            text: 'What is 2 + 3?',
            options: ['4', '5', '6', '3'],
            correct_index: 1,
            difficulty: 'easy'
          },
          {
            text: 'Solve for x: 2x = 10',
            options: ['2', '5', '10', '8'],
            correct_index: 1,
            difficulty: 'easy'
          }
        ]
      },
      {
        title: 'Geometry',
        questions: [
          {
            text: 'How many sides does a hexagon have?',
            options: ['5', '6', '7', '8'],
            correct_index: 1,
            difficulty: 'easy'
          }
        ]
      }
    ]
  },
  {
    title: 'English',
    description: 'Basic English exam',
    sections: [
      {
        title: 'Grammar',
        questions: [
          {
            text: 'Choose the correct form: "She ___ to school every day."',
            options: ['go', 'goes', 'going', 'gone'],
            correct_index: 1,
            difficulty: 'easy'
          }
        ]
      },
      {
        title: 'Reading',
        questions: [
          {
            text: 'What is the main idea of a short passage?',
            options: ['Theme', 'Font', 'Author age', 'Page number'],
            correct_index: 0,
            difficulty: 'medium'
          }
        ]
      }
    ]
  },
  {
    title: 'Science',
    description: 'Basic science exam',
    sections: [
      {
        title: 'Physics',
        questions: [
          {
            text: 'What force pulls objects toward Earth?',
            options: ['Friction', 'Magnetism', 'Gravity', 'Electricity'],
            correct_index: 2,
            difficulty: 'easy'
          }
        ]
      },
      {
        title: 'Biology',
        questions: [
          {
            text: 'What is the basic unit of life?',
            options: ['Atom', 'Cell', 'Organ', 'Tissue'],
            correct_index: 1,
            difficulty: 'easy'
          }
        ]
      }
    ]
  }
];

(async function seed() {
  try {
    await init();

    // skip if exams already present
    const existing = await all('SELECT id FROM exams LIMIT 1');
    if (existing.length > 0) {
      console.log('Database already seeded (exams exist).');
      return;
    }

    for (const ex of exams) {
      const resExam = await run('INSERT INTO exams (title, description) VALUES (?, ?)', [ex.title, ex.description || null]);
      const examId = resExam.id;
      for (const sec of ex.sections) {
        const resSec = await run('INSERT INTO sections (exam_id, title, question_count) VALUES (?, ?, ?)', [
          examId,
          sec.title,
          (sec.questions && sec.questions.length) || 0
        ]);
        const sectionId = resSec.id;
        if (sec.questions && sec.questions.length) {
          for (const q of sec.questions) {
            await run(
              'INSERT INTO questions (section_id, text, options_json, correct_index, difficulty) VALUES (?, ?, ?, ?, ?)',
              [sectionId, q.text, JSON.stringify(q.options || []), q.correct_index || 0, q.difficulty || 'medium']
            );
          }
        }
      }
    }

    console.log('Seeding complete: sample exams added (Math, English, Science).');
  } catch (e) {
    console.error('Seeding failed:', e);
    process.exitCode = 1;
  }
})();