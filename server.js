const express = require('express');
const mysql = require('mysql');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const compression = require('compression');
const { Redis } = require('@upstash/redis');
const spotDataUpload = require('./spotDataUpload');

const app = express();
app.use(bodyParser.json());
app.use(cors());
app.use(compression());

// Set up Redis using Upstash
const redis = new Redis({
  url: process.env.REDIS_URL,
  token: process.env.REDIS_TOKEN,
});

// MySQL connection pools
const dbMytables = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: 'mytables',
  connectionLimit: 10
});

const dbRateMyCourse = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: 'ratemycourse',
  connectionLimit: 10
});

// Handle pool errors
dbMytables.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

dbRateMyCourse.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

function queryPromise(db, sql, values) {
  return new Promise((resolve, reject) => {
    db.getConnection((err, connection) => {
      if (err) {
        return reject(err);
      }
      connection.query(sql, values, (error, results) => {
        connection.release();
        if (error) {
          console.error('SQL Error:', error);
          return reject(error);
        }
        resolve(results);
      });
    });
  });
}

app.get('/', (req, res) => {
  res.send('Server is running');
});

// Server-side Pagination for /api/all-data with Redis caching
app.get('/api/all-data', async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;
  const cacheKey = `all-data-page-${page}-limit-${limit}`;

  try {
    let cachedData = await redis.get(cacheKey);
    if (cachedData) {
      console.log('Returning data from Redis cache');
      try {
        const parsedData = JSON.parse(cachedData);
        return res.json(parsedData);
      } catch (parseError) {
        console.error('Error parsing Redis data:', parseError);
      }
    }

    const coursesQuery = `
      SELECT DISTINCT c.coursecode, c.coursename
      FROM courses c
      JOIN courseofferings co ON c.courseid = co.courseid
      ORDER BY c.coursecode
      LIMIT ? OFFSET ?
    `;
    const professorsQuery = `
      SELECT DISTINCT i.firstname, i.lastname, d.DepartmentName AS department
      FROM instructors i
      JOIN courseofferings co ON i.instructorid = co.instructorid
      JOIN courses c ON co.courseid = c.courseid
      JOIN departments d ON c.departmentid = d.DepartmentID
      ORDER BY i.lastname, i.firstname
      LIMIT ? OFFSET ?
    `;

    const [courses, professors] = await Promise.all([
      queryPromise(dbRateMyCourse, coursesQuery, [limit, offset]),
      queryPromise(dbRateMyCourse, professorsQuery, [limit, offset])
    ]);

    const responseData = { courses, professors, page, limit };
    await redis.set(cacheKey, JSON.stringify(responseData), { ex: 3600 });
    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

// Server-side Pagination for /api/search with Redis caching
app.get('/api/search', async (req, res, next) => {
  const { query, type, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  const cacheKey = `search-${type}-${query}-page-${page}-limit-${limit}`;

  try {
    let cachedData = await redis.get(cacheKey);
    if (cachedData) {
      console.log('Returning search results from Redis cache');
      try {
        const parsedData = JSON.parse(cachedData);
        return res.json(parsedData);
      } catch (parseError) {
        console.error('Error parsing Redis search data:', parseError);
      }
    }

    let searchQuery;
    let queryParams;

    console.log(`Received search query: ${query}, type: ${type}`);

    if (type === 'course') {
      searchQuery = `
        SELECT 
          co.offeringid,
          c.coursecode,
          COALESCE(offer.courseTitle, c.coursename) AS coursename,
          i.firstname,
          i.lastname,
          d.DepartmentName AS department,
          d.Faculty AS faculty,
          co.academicyear,
          co.semester,
          co.section,
          sr.enrollmentcount,
          sr.responsecount,
          sr.lastupdated,
          sq.QuestionText AS question,
          sq.StronglyDisagree,
          sq.Disagree,
          sq.Neither,
          sq.Agree,
          sq.StronglyAgree,
          sq.Median
        FROM courseofferings co
        JOIN courses c ON co.courseid = c.courseid
        JOIN instructors i ON co.instructorid = i.instructorid
        JOIN departments d ON c.departmentid = d.DepartmentID
        LEFT JOIN spot_ratings sr ON co.offeringid = sr.offeringid
        LEFT JOIN spot_questions sq ON sr.ratingid = sq.ratingid
        LEFT JOIN courseofferdb offer ON CONCAT(offer.courseLetter, ' ', offer.courseNumber) = c.coursecode
        WHERE c.coursecode = ?
        LIMIT ? OFFSET ?
      `;
      queryParams = [query, parseInt(limit), parseInt(offset)];
    } else if (type === 'professor') {
      const [lastName, firstName] = query.split(',').map(name => name.trim());
      searchQuery = `
        SELECT 
          co.offeringid,
          c.coursecode,
          COALESCE(offer.courseTitle, c.coursename) AS coursename,
          i.firstname,
          i.lastname,
          d.DepartmentName AS department,
          d.Faculty AS faculty,
          co.academicyear,
          co.semester,
          co.section,
          sr.enrollmentcount,
          sr.responsecount,
          sr.lastupdated,
          sq.QuestionText AS question,
          sq.StronglyDisagree,
          sq.Disagree,
          sq.Neither,
          sq.Agree,
          sq.StronglyAgree,
          sq.Median
        FROM courseofferings co
        JOIN courses c ON co.courseid = c.courseid
        JOIN instructors i ON co.instructorid = i.instructorid
        JOIN departments d ON c.departmentid = d.DepartmentID
        LEFT JOIN spot_ratings sr ON co.offeringid = sr.offeringid
        LEFT JOIN spot_questions sq ON sr.ratingid = sq.ratingid
        LEFT JOIN courseofferdb offer ON CONCAT(offer.courseLetter, ' ', offer.courseNumber) = c.coursecode
        WHERE i.lastname = ? AND i.firstname = ?
        LIMIT ? OFFSET ?
      `;
      queryParams = [lastName, firstName, parseInt(limit), parseInt(offset)];
    } else {
      const searchPattern = `%${query}%`;
      searchQuery = `
        SELECT 
          co.offeringid,
          c.coursecode,
          COALESCE(offer.courseTitle, c.coursename) AS coursename,
          i.firstname,
          i.lastname,
          d.DepartmentName AS department,
          d.Faculty AS faculty,
          co.academicyear,
          co.semester,
          co.section,
          sr.enrollmentcount,
          sr.responsecount,
          sr.lastupdated,
          sq.QuestionText AS question,
          sq.StronglyDisagree,
          sq.Disagree,
          sq.Neither,
          sq.Agree,
          sq.StronglyAgree,
          sq.Median
        FROM courseofferings co
        JOIN courses c ON co.courseid = c.courseid
        JOIN instructors i ON co.instructorid = i.instructorid
        JOIN departments d ON c.departmentid = d.DepartmentID
        LEFT JOIN spot_ratings sr ON co.offeringid = sr.offeringid
        LEFT JOIN spot_questions sq ON sr.ratingid = sq.ratingid
        LEFT JOIN courseofferdb offer ON CONCAT(offer.courseLetter, ' ', offer.courseNumber) = c.coursecode
        WHERE c.coursecode LIKE ? 
        OR c.coursename LIKE ? 
        OR i.firstname LIKE ? 
        OR i.lastname LIKE ?
        OR CONCAT(i.firstname, ' ', i.lastname) LIKE ?
        LIMIT ? OFFSET ?
      `;
      queryParams = [searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, parseInt(limit), parseInt(offset)];
    }

    let results = await queryPromise(dbRateMyCourse, searchQuery, queryParams);

    // Grouping results by offeringid
    results = results.reduce((acc, row) => {
      let existingOffering = acc.find(item => item.offeringid === row.offeringid);

      if (!existingOffering) {
        existingOffering = {
          offeringid: row.offeringid,
          coursecode: row.coursecode,
          coursename: row.coursename,
          firstname: row.firstname,
          lastname: row.lastname,
          department: row.department,
          faculty: row.faculty,
          academicyear: row.academicyear,
          semester: row.semester,
          section: row.section,
          enrollmentcount: row.enrollmentcount,
          responsecount: row.responsecount,
          lastupdated: row.lastupdated,
          ratings: [],
          gpas: [],
        };
        acc.push(existingOffering);
      }

      if (row.question) {
        existingOffering.ratings.push({
          question: row.question,
          stronglydisagree: row.StronglyDisagree,
          disagree: row.Disagree,
          neither: row.Neither,
          agree: row.Agree,
          stronglyagree: row.StronglyAgree,
          median: row.Median,
        });
      }

      return acc;
    }, []);

    // Cross-reference with crowdsourcedb for GPA data
    for (let result of results) {
      const gpaQuery = `
        SELECT gpa, classSize, term, section
        FROM crowdsourcedb
        WHERE courseNumber = ?
        AND professorNames LIKE CONCAT('%', ?, '%')
      `;
      const gpaResults = await queryPromise(dbRateMyCourse, gpaQuery, [
        result.coursecode,
        `${result.firstname} ${result.lastname}`,
      ]);
      result.gpas = gpaResults;
    }

    console.log(`Search results for query "${query}":`, results);
    await redis.set(cacheKey, JSON.stringify(results), { ex: 3600 });
    res.json(results);
  } catch (error) {
    next(error);
  }
});

// Route handling for 'ratemycourse' related data
app.use('/api', spotDataUpload(dbRateMyCourse));

// Register route for main page (login_info table in 'mytables')
app.post('/register', async (req, res, next) => {
  const { username, password, dob, country } = req.body;

  if (!username || !password || !dob || !country) {
    return res.status(400).json({ error: 'Please provide all required fields' });
  }

  try {
    const checkUserQuery = 'SELECT * FROM login_info WHERE username = ?';
    const results = await queryPromise(dbMytables, checkUserQuery, [username]);

    if (results.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const insertUserQuery = 'INSERT INTO login_info (username, password, dob, country) VALUES (?, ?, ?, ?)';
    await queryPromise(dbMytables, insertUserQuery, [username, hashedPassword, dob, country]);

    res.status(200).json({ message: 'Registration successful' });
  } catch (error) {
    next(error);
  }
});

// Register route for database access (users table in 'mytables')
app.post('/register-db', async (req, res, next) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Please provide both username and password' });
  }

  try {
    const checkUserQuery = 'SELECT * FROM users WHERE username = ?';
    const results = await queryPromise(dbMytables, checkUserQuery, [username]);

    if (results.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const insertUserQuery = 'INSERT INTO users (username, password) VALUES (?, ?)';
    await queryPromise(dbMytables, insertUserQuery, [username, hashedPassword]);

    res.status(200).json({ message: 'Registration successful' });
  } catch (error) {
    next(error);
  }
});

// Login route for main page (login_info table in 'mytables')
app.post('/login', async (req, res, next) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Please provide both username and password' });
  }

  try {
    const checkUserQuery = 'SELECT * FROM login_info WHERE username = ?';
    const results = await queryPromise(dbMytables, checkUserQuery, [username]);

    if (results.length === 0) {
      return res.status(404).json({ error: 'User does not exist' });
    }

    const user = results[0];
    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Password incorrect' });
    }

    res.status(200).json({ message: 'Login successful' });
  } catch (error) {
    next(error);
  }
});

app.post('/api/checkExistingData', async (req, res, next) => {
  const { academicYear, courseCode, courseType, section, instructorFirstName, instructorLastName } = req.body;

  try {
    const [existingData] = await queryPromise(dbRateMyCourse, `
      SELECT * FROM courseofferings co
      JOIN courses c ON co.courseid = c.courseid
      JOIN instructors i ON co.instructorid = i.instructorid
      WHERE co.academicyear = ?
      AND c.coursecode = ?
      AND co.semester = ?
      AND co.section = ?
      AND i.firstname = ?
      AND i.lastname = ?
    `, [academicYear, courseCode, courseType, section, instructorFirstName, instructorLastName]);

    res.json({ exists: !!existingData });
  } catch (error) {
    next(error);
  }
});

// Login route for database access (users table in 'mytables')
app.post('/login-db', async (req, res, next) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Please provide both username and password' });
  }

  try {
    const checkUserQuery = 'SELECT * FROM users WHERE username = ?';
    const results = await queryPromise(dbMytables, checkUserQuery, [username]);

    if (results.length === 0) {
      return res.status(404).json({ error: 'User does not exist' });
    }

    const user = results[0];
    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Password incorrect' });
    }

    res.status(200).json({ message: 'Login successful' });
  } catch (error) {
    next(error);
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'An unexpected error occurred' });
});

// Server start
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
