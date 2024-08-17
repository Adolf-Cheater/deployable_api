const express = require('express');
const mysql = require('mysql');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const compression = require('compression');

const app = express();
app.use(bodyParser.json());
app.use(cors());
app.use(compression());

// MySQL connection pools
const dbConfig = {
  host: 'rm-2ze8y04111hiut0r60o.mysql.rds.aliyuncs.com',
  user: 'main',
  password: 'Woshishabi2004',
  connectionLimit: 10
};

const dbMytables = mysql.createPool({
  ...dbConfig,
  database: 'mytables'
});

const dbRateMyCourse = mysql.createPool({
  ...dbConfig,
  database: 'ratemycourse'
});

function queryPromise(db, sql, values) {
  return new Promise((resolve, reject) => {
    db.query(sql, values, (error, results) => {
      if (error) {
        console.error('SQL Error:', error);
        return reject(error);
      }
      resolve(results);
    });
  });
}

// Simple in-memory cache
const cache = new Map();
const CACHE_TTL = 300000; // 5 minutes

function getCachedData(key) {
  const cachedItem = cache.get(key);
  if (cachedItem && Date.now() - cachedItem.timestamp < CACHE_TTL) {
    return cachedItem.data;
  }
  return null;
}

function setCachedData(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

app.get('/', (req, res) => {
  res.send('Server is running');
});

app.get('/api/all-data', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  const cacheKey = `all-data-${page}-${limit}`;
  const cachedData = getCachedData(cacheKey);

  if (cachedData) {
    return res.json(cachedData);
  }

  try {
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

    const result = { courses, professors, page, limit };
    setCachedData(cacheKey, result);
    res.json(result);
  } catch (error) {
    console.error('Error fetching all data:', error);
    res.status(500).json({ error: 'Database error: ' + error.message });
  }
});

app.get('/api/search', async (req, res) => {
  const { query, type, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  const cacheKey = `search-${type}-${query}-${page}-${limit}`;
  const cachedData = getCachedData(cacheKey);

  if (cachedData) {
    return res.json(cachedData);
  }

  try {
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
      // General search
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
          gpas: []
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
          median: row.Median
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
        LIMIT 10
      `;
      const gpaResults = await queryPromise(dbRateMyCourse, gpaQuery, [
        result.coursecode,
        `${result.firstname} ${result.lastname}`
      ]);
      result.gpas = gpaResults;
    }

    setCachedData(cacheKey, results);
    res.json(results);
  } catch (error) {
    console.error('Database query error:', error);
    res.status(500).json({ error: 'Database error: ' + error.message });
  }
});

app.post('/register', async (req, res) => {
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
    console.error('Database query error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/register-db', async (req, res) => {
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
    console.error('Database query error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/login', async (req, res) => {
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
    console.error('Database query error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/checkExistingData', async (req, res) => {
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
    console.error('Error checking existing data:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/login-db', async (req, res) => {
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
    console.error('Database query error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'An unexpected error occurred' });
});

// Health check route
app.get('/health', async (req, res) => {
  try {
    await Promise.all([
      queryPromise(dbMytables, 'SELECT 1'),
      queryPromise(dbRateMyCourse, 'SELECT 1')
    ]);
    res.status(200).json({ status: 'healthy' });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({ status: 'unhealthy', error: error.message });
  }
});

// Server start
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  dbMytables.end((err) => {
    if (err) {
      console.error('Error closing mytables database connection:', err);
    }
    console.log('Mytables database connection closed');
  });
  dbRateMyCourse.end((err) => {
    if (err) {
      console.error('Error closing ratemycourse database connection:', err);
    }
    console.log('Ratemycourse database connection closed');
  });
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});
