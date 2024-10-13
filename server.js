import { OpenAI } from 'openai';
import { Pinecone } from 'pinecone-client';
import dotenv from 'dotenv';

dotenv.config();

const pc = new Pinecone();
const index = pc.Index("bearpath");
const openaiApiKey = process.env.OPENAI_API_KEY;
const pineconeApiKey = process.env.PINECONE_API_KEY;

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();

// Use body-parser middleware to parse JSON bodies
app.use(bodyParser.json());
app.use(express.json());
app.use(cors());

// Configure PostgreSQL connection
const pool = new Pool({
  user: 'main',
  host: 'general-usuage.chkscywoifga.us-east-2.rds.amazonaws.com',
  database: 'ratemycourse',
  password: 'Woshishabi2004!',
  port: 5432,
  ssl: {
    rejectUnauthorized: false  // Ensure SSL is properly configured
  }
});

const poolCourseReq = new Pool({
  user: 'main',
  host: 'general-usuage.chkscywoifga.us-east-2.rds.amazonaws.com',
  database: 'coursereq',
  password: 'Woshishabi2004!',
  port: 5432,
  ssl: {
    rejectUnauthorized: false  // Ensure SSL is properly configured
  }
});


// Root route for basic health check
app.get('/', (req, res) => {
  res.send('Server is running');
});

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Server is running' });
});

app.post('/api/query', async (req, res) => {
  console.log("POST /api/query called");

  const { question } = req.body;
  console.log("Received request with body:", req.body);

  if (!question) {
    console.log("No question provided in request body");
    return res.status(400).json({ error: 'Question is required' });
  }

  try {
    console.log("Initializing OpenAI client...");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log("OpenAI client initialized");

    // Get embedding for the question
    console.log("Getting embedding for the question:", question);
    const embeddingResponse = await client.embeddings.create({
      model: "text-embedding-ada-002",
      input: question,
    });
    console.log("Received embedding response:", embeddingResponse.data);

    const questionEmbedding = embeddingResponse.data[0]?.embedding;
    if (!questionEmbedding) {
      console.error("Error: No embedding returned from OpenAI");
      return res.status(500).json({ error: 'Failed to generate embedding from OpenAI' });
    }

    // Query Pinecone
    console.log("Querying Pinecone with the embedding...");
    const queryResponse = await index.query({
      vector: questionEmbedding,
      topK: 5,
      includeMetadata: true
    });
    console.log("Pinecone query response:", queryResponse);

    if (!queryResponse.matches || queryResponse.matches.length === 0) {
      console.error("No matches found from Pinecone query");
    }

    // Format context from Pinecone results
    let context = "";
    for (let match of queryResponse.matches) {
      console.log("Processing match:", match.metadata);
      if (match.metadata.type === 'gpa') {
        context += `Course: ${match.metadata.department} ${match.metadata.courseNumber}, `
          + `Professor: ${match.metadata.professorNames}, `
          + `Term: ${match.metadata.term}, `
          + `Section: ${match.metadata.section}, `
          + `GPA: ${match.metadata.gpa}, `
          + `Class Size: ${match.metadata.classSize}\n\n`;
      } else if (match.metadata.type === 'course') {
        context += `Course: ${match.metadata.courseLetter} ${match.metadata.courseNumber}, `
          + `Title: ${match.metadata.courseTitle}, `
          + `Units: ${match.metadata.Units}, `
          + `Description: ${match.metadata.courseDescription}, `
          + `Faculty: ${match.metadata.facultyName}\n\n`;
      }
    }

    console.log("Formatted context for query:", context);

    // Query the fine-tuned model
    console.log("Querying fine-tuned model with context and user question");
    const chatCompletion = await client.chat.completions.create({
      model: "ft:gpt-4o-mini-2024-07-18:personal::AHmNGvuH", // Your fine-tuned model
      messages: [
        {
          role: "system",
          content: "You are a knowledgeable and helpful course advisor assistant for RateMyCourse. You provide information about courses, professors, and GPAs based on the data available."
        },
        {
          role: "user",
          content: `Based on the following course information:\n\n${context}\n\nUser question: ${question}\n\nPlease provide a helpful response:`
        }
      ],
    });

    const answer = chatCompletion.choices[0]?.message?.content;
    if (!answer) {
      console.error("No response received from fine-tuned model");
      return res.status(500).json({ error: 'Failed to generate response from fine-tuned model' });
    }

    console.log("Generated answer from model:", answer);

    res.json({ answer });
  } catch (error) {
    console.error('Error processing query:', error);
    res.status(500).json({ error: `An error occurred while processing your query: ${error.message}` });
  }
});

app.get('/api/coursereq/courses', async (req, res) => {
  const client = await poolCourseReq.connect();
  try {
    // Fetch all courses from coursesdb with their requirements
    const coursesQuery = `
      SELECT 
        c.course_letter, 
        c.course_number, 
        c.course_title, 
        c.units,
        CASE WHEN jr.course_letter IS NOT NULL THEN TRUE ELSE FALSE END AS junior_core,
        CASE WHEN sm.course_letter IS NOT NULL THEN TRUE ELSE FALSE END AS major,
        CASE WHEN smi.course_letter IS NOT NULL THEN TRUE ELSE FALSE END AS minor,
        CASE WHEN ao.course_letter IS NOT NULL THEN TRUE ELSE FALSE END AS arts_option
      FROM 
        coursesdb c
      LEFT JOIN jrreq jr ON c.course_letter = jr.course_letter AND c.course_number = jr.course_number
      LEFT JOIN sciencemajorreq sm ON c.course_letter = sm.course_letter AND c.course_number = sm.course_number
      LEFT JOIN scienceminorreq smi ON c.course_letter = smi.course_letter AND c.course_number = smi.course_number
      LEFT JOIN artsoptionreq ao ON c.course_letter = ao.course_letter AND c.course_number = ao.course_number
    `;

    const coursesResult = await client.query(coursesQuery);
    const courses = coursesResult.rows.map(row => ({
      course: {
        course_letter: row.course_letter,
        course_number: row.course_number,
        course_title: row.course_title,
        units: row.units
      },
      requirements: {
        juniorCore: row.junior_core,
        major: row.major,
        minor: row.minor,
        artsOption: row.arts_option
      }
    }));

    res.json(courses);
  } catch (err) {
    console.error('Error fetching courses and requirements:', err);
    res.status(500).json({ error: 'Failed to fetch courses and requirements' });
  } finally {
    client.release();
  }
});


app.get('/api/coursereq/search', async (req, res) => {
  const { query } = req.query;
  const client = await poolCourseReq.connect();

  try {
    const searchPattern = `%${query}%`;

    // Search for matching courses in coursesdb
    const searchQuery = `
      SELECT 
        course_letter, 
        course_number, 
        course_title, 
        units 
      FROM 
        coursesdb
      WHERE 
        LOWER(CONCAT(course_letter, ' ', course_number)) LIKE LOWER($1)
        OR LOWER(course_title) LIKE LOWER($1)
      LIMIT 10
    `;

    const coursesResult = await client.query(searchQuery, [searchPattern]);
    const courses = coursesResult.rows.map(row => ({
      course_code: `${row.course_letter} ${row.course_number}`,
      course_name: row.course_title
    }));

    res.json({ courses });
  } catch (error) {
    console.error('Error searching courses:', error);
    res.status(500).json({ error: 'An error occurred while searching.' });
  } finally {
    client.release();
  }
});

app.get('/api/requirements/:major', async (req, res) => {
  const { major } = req.params;
  const client = await poolCourseReq.connect();
  try {
    const facultyReqQuery = 'SELECT * FROM FacultyRequirements WHERE faculty_name = $1';
    const majorReqQuery = 'SELECT * FROM ScienceMajorReq WHERE major_name = $1';
    
    const [facultyReq, majorReq] = await Promise.all([
      client.query(facultyReqQuery, ['Science']),
      client.query(majorReqQuery, [major])
    ]);

    // Group major requirements by level_group
    const groupedMajorReq = majorReq.rows.reduce((acc, req) => {
      if (!acc[req.level_group]) {
        acc[req.level_group] = [];
      }
      acc[req.level_group].push({
        course_letter: req.course_letter,
        course_number: req.course_number,
        course_group: req.course_group,
        completed: false // Initialize as not completed
      });
      return acc;
    }, {});

    res.json({
      facultyRequirements: facultyReq.rows[0],
      majorRequirements: groupedMajorReq
    });
  } catch (error) {
    console.error('Error fetching major requirements:', error);
    res.status(500).json({ error: 'An error occurred while fetching requirements' });
  } finally {
    client.release();
  }
});

app.get('/api/science-faculty-requirements', async (req, res) => {
  const client = await poolCourseReq.connect();
  try {
    const facultyReqQuery = 'SELECT * FROM FacultyRequirements WHERE faculty_name = $1';
    
    const facultyReq = await client.query(facultyReqQuery, ['Science']);

    if (facultyReq.rows.length === 0) {
      return res.status(404).json({ error: 'Science faculty requirements not found' });
    }

    const requirements = facultyReq.rows[0];

    res.json({
      facultyName: requirements.faculty_name,
      totalCoursesRequired: requirements.total_courses_required,
      minUpperLevelCourses: requirements.min_upper_level_courses,
      minFacultyCourses: requirements.min_faculty_courses
    });
  } catch (error) {
    console.error('Error fetching Science faculty requirements:', error);
    res.status(500).json({ error: 'An error occurred while fetching Science faculty requirements' });
  } finally {
    client.release();
  }
});

app.get('/api/junior-core-requirements', async (req, res) => {
  const client = await poolCourseReq.connect();
  try {
    const jrReqQuery = 'SELECT * FROM JrReq';
    const result = await client.query(jrReqQuery);
    
    // Group the requirements by category
    const groupedRequirements = result.rows.reduce((acc, req) => {
      if (!acc[req.category]) {
        acc[req.category] = [];
      }
      acc[req.category].push({
        course_letter: req.course_letter,
        course_number: req.course_number
      });
      return acc;
    }, {});

    res.json(groupedRequirements);
  } catch (error) {
    console.error('Error fetching junior core requirements:', error);
    res.status(500).json({ error: 'An error occurred while fetching junior core requirements' });
  } finally {
    client.release();
  }
});


app.get('/api/requirements/:minor/minor', async (req, res) => {
  const { minor } = req.params;
  const client = await poolCourseReq.connect();
  try {
    const minorReqQuery = 'SELECT * FROM ScienceMinorReq WHERE minor_name = $1';
    
    const minorReq = await client.query(minorReqQuery, [minor]);

    // Group minor requirements by level_group
    const groupedMinorReq = minorReq.rows.reduce((acc, req) => {
      if (!acc[req.level_group]) {
        acc[req.level_group] = [];
      }
      acc[req.level_group].push({
        course_letter: req.course_letter,
        course_number: req.course_number,
        course_group: req.course_group,
        completed: false // Initialize as not completed
      });
      return acc;
    }, {});

    res.json({
      minorRequirements: groupedMinorReq
    });
  } catch (error) {
    console.error('Error fetching minor requirements:', error);
    res.status(500).json({ error: 'An error occurred while fetching minor requirements' });
  } finally {
    client.release();
  }
});

// Data upload endpoint
app.post('/api/upload', async (req, res) => {
  console.log('Attempting to connect to database:', pool.options.database);
  console.log('Using database host:', pool.options.host);

  const client = await pool.connect();

  try {
    console.log('Successfully connected to the database.');
    await client.query('BEGIN');

    const uploadData = req.body;

    if (Array.isArray(uploadData)) {
      for (const data of uploadData) {
        await processUpload(client, data);
      }
    } else {
      await processUpload(client, uploadData);
    }

    await client.query('COMMIT');
    console.log('Data uploaded successfully');
    res.status(200).json({ message: 'Data uploaded successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error processing upload:', error);
    res.status(500).json({ error: 'An error occurred while processing the upload: ' + error.message });
  } finally {
    client.release();
    console.log('Database connection released.');
  }
});

// Function to process individual upload data
async function processUpload(client, data) {
  // Insert or get department
  const departmentResult = await client.query(
    `INSERT INTO departments (department_name, faculty) 
     VALUES ($1, $2) 
     ON CONFLICT (department_name, faculty) DO UPDATE 
     SET department_name = EXCLUDED.department_name 
     RETURNING department_id`,
    [data.department, data.faculty]
  );
  const departmentId = departmentResult.rows[0].department_id;

  // Insert or get instructor
  const instructorResult = await client.query(
    `INSERT INTO instructors (first_name, last_name, department_id) 
     VALUES ($1, $2, $3) 
     ON CONFLICT (first_name, last_name, department_id) DO UPDATE 
     SET first_name = EXCLUDED.first_name 
     RETURNING instructor_id`,
    [data.instructorFirstName, data.instructorLastName, departmentId]
  );
  const instructorId = instructorResult.rows[0].instructor_id;

  // Insert or get course
  const courseResult = await client.query(
    `INSERT INTO courses (course_code, course_name) 
     VALUES ($1, $2) 
     ON CONFLICT (course_code) DO UPDATE 
     SET course_name = EXCLUDED.course_name 
     RETURNING course_id`,
    [data.courseCode, data.courseName]
  );
  const courseId = courseResult.rows[0].course_id;

  if (data.courseType === 'LEC') {
    // Insert lecture offering
    const offeringResult = await client.query(
      `INSERT INTO course_offerings (course_id, instructor_id, academic_year, course_type, section, class_size, response_count, process_date) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       ON CONFLICT (course_id, instructor_id, academic_year, course_type, section) DO UPDATE 
       SET class_size = EXCLUDED.class_size, response_count = EXCLUDED.response_count, process_date = EXCLUDED.process_date 
       RETURNING offering_id`,
      [courseId, instructorId, data.academicYear, data.courseType, data.section, data.classSize, data.responseCount, data.processDate]
    );
    const offeringId = offeringResult.rows[0].offering_id;

    // Process questions
    for (const question of data.questions) {
      // Insert or get question template
      const questionResult = await client.query(
        `INSERT INTO question_templates (question_text) 
         VALUES ($1) 
         ON CONFLICT (question_text) DO UPDATE 
         SET question_text = EXCLUDED.question_text 
         RETURNING question_id`,
        [question.text]
      );
      const questionId = questionResult.rows[0].question_id;

      // Insert question response for lecture
      await client.query(
        `INSERT INTO question_responses (offering_id, question_id, strongly_disagree, disagree, neither, agree, strongly_agree, median) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
         ON CONFLICT (offering_id, question_id) DO UPDATE 
         SET strongly_disagree = EXCLUDED.strongly_disagree, disagree = EXCLUDED.disagree, neither = EXCLUDED.neither, agree = EXCLUDED.agree, strongly_agree = EXCLUDED.strongly_agree, median = EXCLUDED.median`,
        [offeringId, questionId, question.stronglyDisagree, question.disagree, question.neither, question.agree, question.stronglyAgree, question.median]
      );
    }
  } else if (data.courseType === 'LAB') {
    // Insert lab offering
    const labOfferingResult = await client.query(
      `INSERT INTO lab_offerings (course_id, instructor_id, academic_year, lab_section, lab_size, lab_response_count, lab_process_date) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       ON CONFLICT (course_id, instructor_id, academic_year, lab_section) DO UPDATE 
       SET lab_size = EXCLUDED.lab_size, lab_response_count = EXCLUDED.lab_response_count, lab_process_date = EXCLUDED.lab_process_date 
       RETURNING lab_offering_id`,
      [courseId, instructorId, data.academicYear, data.section, data.classSize, data.responseCount, data.processDate]
    );
    const labOfferingId = labOfferingResult.rows[0].lab_offering_id;

    // Process questions
    for (const question of data.questions) {
      // Insert or get question template
      const questionResult = await client.query(
        `INSERT INTO question_templates (question_text) 
         VALUES ($1) 
         ON CONFLICT (question_text) DO UPDATE 
         SET question_text = EXCLUDED.question_text 
         RETURNING question_id`,
        [question.text]
      );
      const questionId = questionResult.rows[0].question_id;

      // Insert question response for lab
      await client.query(
        `INSERT INTO question_responses (lab_offering_id, question_id, strongly_disagree, disagree, neither, agree, strongly_agree, median) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
         ON CONFLICT (lab_offering_id, question_id) DO UPDATE 
         SET strongly_disagree = EXCLUDED.strongly_disagree, disagree = EXCLUDED.disagree, neither = EXCLUDED.neither, agree = EXCLUDED.agree, strongly_agree = EXCLUDED.strongly_agree, median = EXCLUDED.median`,
        [labOfferingId, questionId, question.stronglyDisagree, question.disagree, question.neither, question.agree, question.stronglyAgree, question.median]
      );
    }
  }
}



// New retrieval endpoint for searching by course code or professor name
app.get('/api/search', async (req, res) => {
  const { query } = req.query;
  const client = await pool.connect();

  try {
    const searchPattern = `%${query}%`;

    // Optimized query to fetch matching courses with names from coursesdb
    const courseQuery = `
      WITH matched_courses AS (
        SELECT c.course_code, COALESCE(cdb.course_title, c.course_name) as course_name
        FROM courses c
        LEFT JOIN coursesdb cdb ON REPLACE(CONCAT(cdb.course_letter, cdb.course_number), ' ', '') = REPLACE(c.course_code, ' ', '')
        WHERE c.course_code ILIKE $1 OR COALESCE(cdb.course_title, c.course_name) ILIKE $1
        LIMIT 10
      )
      SELECT * FROM matched_courses
      ORDER BY 
        CASE 
          WHEN course_code ILIKE $1 THEN 0
          WHEN course_name ILIKE $1 THEN 1
          ELSE 2
        END,
        course_code
    `;

    const professorQuery = `
      SELECT i.first_name, i.last_name, d.department_name
      FROM instructors i
      JOIN departments d ON i.department_id = d.department_id
      WHERE i.first_name ILIKE $1 OR i.last_name ILIKE $1 OR CONCAT(i.first_name, ' ', i.last_name) ILIKE $1
      ORDER BY 
        CASE 
          WHEN i.last_name ILIKE $1 THEN 0
          WHEN i.first_name ILIKE $1 THEN 1
          ELSE 2
        END,
        i.last_name, i.first_name
      LIMIT 10
    `;

    console.log('Executing course query:', courseQuery);
    console.log('Executing professor query:', professorQuery);
    console.log('Search pattern:', searchPattern);

    const [courseResult, professorResult] = await Promise.all([
      client.query(courseQuery, [searchPattern]),
      client.query(professorQuery, [searchPattern])
    ]);

    console.log('Course results:', courseResult.rows);
    console.log('Professor results:', professorResult.rows);

    res.json({
      courses: courseResult.rows,
      professors: professorResult.rows
    });
  } catch (error) {
    console.error('Error fetching data:', error);
    res.status(500).json({ error: 'An error occurred while fetching data.' });
  } finally {
    client.release();
  }
});

// Retrieve all courses and professors
app.get('/api/all-data', async (req, res) => {
  const client = await pool.connect();

  try {
    // Fetch all courses
    const coursesQuery = `
      SELECT course_code, course_name
      FROM courses
    `;
    const coursesResult = await client.query(coursesQuery);

    // Fetch all professors
    const professorsQuery = `
      SELECT i.first_name, i.last_name, d.department_name
      FROM instructors i
      JOIN departments d ON i.department_id = d.department_id
    `;
    const professorsResult = await client.query(professorsQuery);

    res.json({
      courses: coursesResult.rows,
      professors: professorsResult.rows
    });
  } catch (error) {
    console.error('Error fetching data:', error);
    res.status(500).json({ error: 'An error occurred while fetching data.' });
  } finally {
    client.release();
  }
});

// Course details endpoint (lectures only)
app.get('/api/course/:courseCode', async (req, res) => {
  const { courseCode } = req.params;
  const client = await pool.connect();

  try {
    // Normalize the incoming course code by removing spaces for comparison
    const normalizedCourseCode = courseCode.replace(/\s+/g, '').toUpperCase();

    // Fetch course title, units, and description from coursesdb if normalized course_code matches
    const courseDetailsQuery = `
      SELECT course_title, units, course_description
      FROM coursesdb
      WHERE REPLACE(CONCAT(course_letter, course_number), ' ', '') ILIKE $1
      LIMIT 1
    `;
    const courseDetailsResult = await client.query(courseDetailsQuery, [normalizedCourseCode]);

    const courseDetails = courseDetailsResult.rows[0] || {};
    const { course_title, units, course_description } = courseDetails;

    // Query to fetch lecture offerings with questions
    const sectionsQuery = `
      SELECT 
        c.course_code, 
        c.course_name, 
        i.first_name, 
        i.last_name, 
        d.department_name, 
        co.academic_year, 
        co.section, 
        co.class_size, 
        co.response_count, 
        co.process_date,
        co.offering_id,
        'LEC' as offering_type,
        ARRAY_AGG(jsonb_build_object(
          'question_text', qt.question_text,
          'strongly_disagree', qr.strongly_disagree,
          'disagree', qr.disagree,
          'neither', qr.neither,
          'agree', qr.agree,
          'strongly_agree', qr.strongly_agree,
          'median', qr.median
        )) AS questions
      FROM 
        courses c
      JOIN 
        course_offerings co ON c.course_id = co.course_id
      JOIN 
        instructors i ON co.instructor_id = i.instructor_id
      JOIN 
        departments d ON i.department_id = d.department_id
      LEFT JOIN 
        question_responses qr ON co.offering_id = qr.offering_id
      LEFT JOIN 
        question_templates qt ON qr.question_id = qt.question_id
      WHERE 
        REPLACE(c.course_code, ' ', '') = $1 AND co.course_type = 'LEC'
      GROUP BY 
        c.course_code, 
        c.course_name, 
        i.first_name, 
        i.last_name, 
        d.department_name, 
        co.academic_year, 
        co.section, 
        co.class_size, 
        co.response_count, 
        co.process_date,
        co.offering_id
      ORDER BY 
        co.academic_year DESC, co.section ASC
    `;

    const sectionsResult = await client.query(sectionsQuery, [normalizedCourseCode]);

    const courseData = {
      courseTitle: course_title || 'N/A',
      units: units || 'N/A',
      courseDescription: course_description || 'N/A',
      sections: sectionsResult.rows,
    };

    res.json(courseData);
  } catch (error) {
    console.error('Error fetching course details:', error);
    res.status(500).json({ error: 'An error occurred while fetching course details.' });
  } finally {
    client.release();
  }
});

// New endpoint for fetching lab data
app.get('/api/course/:courseCode/labs', async (req, res) => {
  const { courseCode } = req.params;
  const client = await pool.connect();

  try {
    // Query to fetch lab offerings with questions
    const labsQuery = `
      SELECT 
        c.course_code, 
        c.course_name, 
        i.first_name, 
        i.last_name, 
        d.department_name, 
        lo.academic_year, 
        lo.lab_section as section, 
        lo.lab_size as class_size, 
        lo.lab_response_count as response_count, 
        lo.lab_process_date as process_date,
        lo.lab_offering_id as offering_id,
        'LAB' as offering_type,
        ARRAY_AGG(jsonb_build_object(
          'question_text', qt.question_text,
          'strongly_disagree', qr.strongly_disagree,
          'disagree', qr.disagree,
          'neither', qr.neither,
          'agree', qr.agree,
          'strongly_agree', qr.strongly_agree,
          'median', qr.median
        )) AS questions
      FROM 
        courses c
      JOIN 
        lab_offerings lo ON c.course_id = lo.course_id
      JOIN 
        instructors i ON lo.instructor_id = i.instructor_id
      JOIN 
        departments d ON i.department_id = d.department_id
      LEFT JOIN 
        question_responses qr ON lo.lab_offering_id = qr.lab_offering_id
      LEFT JOIN 
        question_templates qt ON qr.question_id = qt.question_id
      WHERE 
        c.course_code = $1
      GROUP BY 
        c.course_code, 
        c.course_name, 
        i.first_name, 
        i.last_name, 
        d.department_name, 
        lo.academic_year, 
        lo.lab_section, 
        lo.lab_size, 
        lo.lab_response_count, 
        lo.lab_process_date,
        lo.lab_offering_id
      ORDER BY 
        lo.academic_year DESC, lo.lab_section ASC
    `;

    const labsResult = await client.query(labsQuery, [courseCode]);

    res.json({ labs: labsResult.rows });
  } catch (error) {
    console.error('Error fetching lab details:', error);
    res.status(500).json({ error: 'An error occurred while fetching lab details.' });
  } finally {
    client.release();
  }
});

// New endpoint to fetch GPA data for a specific course code
app.get('/api/course/:courseCode/gpas', async (req, res) => {
  const { courseCode } = req.params;
  const client = await pool.connect();

  try {
    // Split course code to extract department and course number
    const [department, coursenumber] = courseCode.split(' ');

    // Debugging: Log the received course code
    //console.log('Received courseCode:', courseCode);
    //console.log('Parsed Department:', department, 'Course Number:', coursenumber);

    // Corrected Query to match department + whitespace + coursenumber in gpadb
    const gpaQuery = `
      SELECT 
        professornames, 
        term, 
        section, 
        gpa 
      FROM gpadb 
      WHERE department = $1 AND coursenumber = $2
    `;

    //console.log('Executing SQL Query:', gpaQuery, 'with values:', [department, coursenumber]);

    const result = await client.query(gpaQuery, [department, coursenumber]);

    if (result.rows.length > 0) {
      //console.log('GPA Data Found:', result.rows);  // Debugging log
      res.json(result.rows);
    } else {
      //console.log('No GPA data found for this course.');
      res.status(404).json({ message: 'No GPA data found for this course.' });
    }
  } catch (error) {
    console.error('Error fetching GPA data:', error.stack);  // Improved error logging with stack trace
    res.status(500).json({ error: 'An error occurred while fetching GPA data.' });
  } finally {
    client.release();
  }
});

// Endpoint for fetching professor details
// Endpoint for fetching professor details
app.get('/api/professor/:firstName/:lastName', async (req, res) => {
  const { firstName, lastName } = req.params;
  const client = await pool.connect();

  console.log(`Fetching data for professor: ${firstName} ${lastName}`);

  try {
    // Query to fetch professor details and their course offerings
    const professorQuery = `
      SELECT 
        i.instructor_id,
        i.first_name, 
        i.last_name, 
        d.department_name,
        d.faculty,
        c.course_code,
        c.course_name,
        co.academic_year,
        co.course_type,
        co.section,
        co.class_size,
        co.response_count,
        co.process_date,
        COALESCE(co.course_type, 'LAB') as offering_type,
        ARRAY_AGG(jsonb_build_object(
          'question_text', qt.question_text,
          'strongly_disagree', qr.strongly_disagree,
          'disagree', qr.disagree,
          'neither', qr.neither,
          'agree', qr.agree,
          'strongly_agree', qr.strongly_agree,
          'median', qr.median
        )) AS questions
      FROM 
        instructors i
      JOIN 
        departments d ON i.department_id = d.department_id
      LEFT JOIN 
        (
          SELECT * FROM course_offerings
          UNION ALL
          SELECT 
            lab_offering_id as offering_id, course_id, instructor_id, 
            academic_year, 'LAB' as course_type, lab_section as section, 
            lab_size as class_size, lab_response_count as response_count, 
            lab_process_date as process_date
          FROM lab_offerings
        ) co ON i.instructor_id = co.instructor_id
      LEFT JOIN 
        courses c ON co.course_id = c.course_id
      LEFT JOIN 
        question_responses qr ON co.offering_id = qr.offering_id
      LEFT JOIN 
        question_templates qt ON qr.question_id = qt.question_id
      WHERE 
        i.first_name ILIKE $1 AND i.last_name ILIKE $2
      GROUP BY 
        i.instructor_id,
        i.first_name, 
        i.last_name, 
        d.department_name,
        d.faculty,
        c.course_code,
        c.course_name,
        co.academic_year,
        co.course_type,
        co.section,
        co.class_size,
        co.response_count,
        co.process_date
      ORDER BY 
        co.academic_year DESC, c.course_code ASC
    `;

    console.log('Executing professor query...');
    const professorResult = await client.query(professorQuery, [firstName, lastName]);
    console.log(`Found ${professorResult.rows.length} rows for professor`);

    if (professorResult.rows.length === 0) {
      console.log('No data found for this professor');
      return res.status(404).json({ message: 'Professor not found' });
    }

    // Organize the data
    const professorData = {
      firstName: professorResult.rows[0].first_name,
      lastName: professorResult.rows[0].last_name,
      department: professorResult.rows[0].department_name,
      faculty: professorResult.rows[0].faculty,
      courses: professorResult.rows.map(row => ({
        courseCode: row.course_code,
        courseName: row.course_name,
        academicYear: row.academic_year,
        courseType: row.course_type,
        section: row.section,
        classSize: row.class_size,
        responseCount: row.response_count,
        processDate: row.process_date,
        offeringType: row.offering_type,
        questions: row.questions
      })).filter(course => course.courseCode !== null) // Filter out null courses
    };

    // Fetch GPA data for this professor
    const gpaQuery = `
      SELECT 
        department, 
        coursenumber, 
        term, 
        section, 
        gpa 
      FROM gpadb 
      WHERE LOWER(professornames) LIKE LOWER($1)
      ORDER BY term DESC, coursenumber ASC
    `;

    console.log('Executing GPA query...');
    const gpaResult = await client.query(gpaQuery, [`%${lastName}, ${firstName}%`]);
    console.log(`Found ${gpaResult.rows.length} GPA entries for professor`);

    professorData.gpaData = gpaResult.rows;

    res.json(professorData);
  } catch (error) {
    console.error('Error fetching professor details:', error);
    res.status(500).json({ error: 'An error occurred while fetching professor details.' });
  } finally {
    client.release();
  }
});


app.get('/api/top-enrolled', async (req, res) => {
  const { type, limit, year } = req.query; // Extract query parameters, including year
  const client = await pool.connect();

  try {
    let query;
    if (type === 'courses') {
      // Query for top enrolled courses with optional year filtering
      query = `
        WITH course_enrollments AS (
          SELECT co.course_id, SUM(co.class_size) as total_enrollment
          FROM course_offerings co
          ${year ? `WHERE RIGHT(co.academic_year, 4) = $2` : ''}  -- Conditional filtering by year
          GROUP BY co.course_id
        ),
        top_courses AS (
          SELECT c.course_code, ce.total_enrollment,
                 COALESCE(cdb.course_title, c.course_name) as course_name
          FROM course_enrollments ce
          JOIN courses c ON ce.course_id = c.course_id
          LEFT JOIN coursesdb cdb ON REPLACE(CONCAT(cdb.course_letter, cdb.course_number), ' ', '') = REPLACE(c.course_code, ' ', '')
          ORDER BY ce.total_enrollment DESC
          LIMIT $1
        )
        SELECT * FROM top_courses
        ORDER BY total_enrollment DESC
      `;
    } else if (type === 'instructors') {
      // Query for top enrolled instructors with optional year filtering
      query = `
        WITH instructor_enrollments AS (
          SELECT co.instructor_id, SUM(co.class_size) as total_enrollment
          FROM course_offerings co
          ${year ? `WHERE RIGHT(co.academic_year, 4) = $2` : ''}  -- Conditional filtering by year
          GROUP BY co.instructor_id
        ),
        top_instructors AS (
          SELECT i.instructor_id, i.first_name, i.last_name, ie.total_enrollment, d.department_name, d.faculty
          FROM instructor_enrollments ie
          JOIN instructors i ON ie.instructor_id = i.instructor_id
          JOIN departments d ON i.department_id = d.department_id  -- Join with departments to get department_name and faculty
          ORDER BY ie.total_enrollment DESC
          LIMIT $1
        )
        SELECT * FROM top_instructors
        ORDER BY total_enrollment DESC
      `;
    } else {
      console.error('Invalid type parameter:', type);
      return res.status(400).json({ error: 'Invalid type specified' }); // Return early for invalid type
    }

    // Conditionally add year parameter to the query execution
    const result = year 
      ? await client.query(query, [parseInt(limit), year]) 
      : await client.query(query, [parseInt(limit)]); // Ensure limit is passed as an integer

    res.json(result.rows); // Send back the JSON result
  } catch (error) {
    console.error('Error fetching top enrolled data:', error); // Detailed error logging
    res.status(500).json({ error: 'An error occurred while fetching top enrolled data.' });
  } finally {
    client.release(); // Ensure client is released
  }
});


app.use((req, res) => {
  console.log(`Unhandled request: ${req.method} ${req.path}`);
  res.status(404).send('Not Found');
});

// Start the server
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
