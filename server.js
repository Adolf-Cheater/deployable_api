const express = require('express');
const mysql = require('mysql');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const levenshtein = require('fast-levenshtein');
const spotDataUpload = require('./spotDataUpload');
const compression = require('compression');

const app = express();
app.use(bodyParser.json());
app.use(cors());

// MySQL connection for 'mytables'
const dbMytables = mysql.createConnection({
  host: 'rm-2ze8y04111hiut0r60o.mysql.rds.aliyuncs.com',
  user: 'main',
  password: 'Woshishabi2004',
  database: 'mytables',
  connectTimeout: 10000
});

// MySQL connection for 'ratemycourse'
const dbRateMyCourse = mysql.createConnection({
  host: 'rm-2ze8y04111hiut0r60o.mysql.rds.aliyuncs.com', // same host
  user: 'main', // same user
  password: 'Woshishabi2004', // same password
  database: 'ratemycourse',
  connectTimeout: 10000
});

dbMytables.connect((err) => {
  if (err) {
    console.error('Database connection to mytables failed:', err.stack);
    return;
  }
  console.log('Connected to mytables database.');

  // Additional setup for mytables, if needed
});

dbRateMyCourse.connect((err) => {
  if (err) {
    console.error('Database connection to ratemycourse failed:', err.stack);
    return;
  }
  console.log('Connected to ratemycourse database.');

  // Additional setup for ratemycourse, if needed
});

// Define queryPromise function
function queryPromise(db, sql, values) {
  return new Promise((resolve, reject) => {
    db.query(sql, values, (error, results) => {
      if (error) {
        console.error('SQL Error:', error);
        console.error('SQL Query:', sql);
        console.error('SQL Values:', values);
        return reject(error);
      }
      resolve(results);
    });
  });
}

// Middleware for the root route
app.get('/', (req, res) => {
  res.send('Server is running');
});

app.get('/api/course-gpa', async (req, res) => {
  const { courseCode } = req.query;

  try {
    // Split the course code to extract the department and course number
    const [department, courseNumber] = courseCode.split(' ');

    if (!department || !courseNumber) {
      return res.status(400).json({ error: 'Invalid course code format.' });
    }

    // Query to fetch matching GPA entries from crowdsourcedb
    const gpaQuery = `
      SELECT gpa, classSize, term, section, professorNames
      FROM crowdsourcedb
      WHERE department = ?
      AND courseNumber = ?
      ORDER BY term DESC, section
    `;

    const gpaResults = await queryPromise(dbRateMyCourse, gpaQuery, [department, courseNumber]);

    if (gpaResults.length === 0) {
      return res.status(404).json({ message: 'No GPA data found for this course.' });
    }

    res.json(gpaResults);
  } catch (error) {
    console.error('Error fetching GPA data:', error);
    res.status(500).json({ error: 'Database error: ' + error.message });
  }
});

app.get('/api/all-data', async (req, res) => {
  try {
    const coursesQuery = `
      SELECT DISTINCT c.coursecode, c.coursename
      FROM courses c
      JOIN courseofferings co ON c.courseid = co.courseid
      ORDER BY c.coursecode
    `;

    const professorsQuery = `
      SELECT DISTINCT i.firstname, i.lastname, d.DepartmentName AS department
      FROM instructors i
      JOIN courseofferings co ON i.instructorid = co.instructorid
      JOIN courses c ON co.courseid = c.courseid
      JOIN departments d ON c.departmentid = d.DepartmentID
      ORDER BY i.lastname, i.firstname
    `;

    const [courses, professors] = await Promise.all([
      queryPromise(dbRateMyCourse, coursesQuery),
      queryPromise(dbRateMyCourse, professorsQuery)
    ]);

    res.json({ courses, professors });
  } catch (error) {
    console.error('Error fetching all data:', error);
    res.status(500).json({ error: 'Database error: ' + error.message });
  }
});

app.get('/api/search', async (req, res) => {
  const { query, type, page = 1, limit = 10 } = req.query;
  let searchQuery;
  let queryParams;
  let countQuery;

  try {
    console.log(`Received search query: ${query}, type: ${type}, page: ${page}, limit: ${limit}`);

    const offset = (page - 1) * limit;

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

    // Add a COUNT query to get total number of results
    countQuery = searchQuery.replace(/SELECT .*? FROM/, 'SELECT COUNT(DISTINCT co.offeringid) as total FROM');
    countQuery = countQuery.split('LIMIT')[0]; // Remove LIMIT clause from count query

    let [results, countResult] = await Promise.all([
      queryPromise(dbRateMyCourse, searchQuery, queryParams),
      queryPromise(dbRateMyCourse, countQuery, queryParams.slice(0, -2)) // Remove LIMIT and OFFSET params
    ]);

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
      `;
      const gpaResults = await queryPromise(dbRateMyCourse, gpaQuery, [
        result.coursecode,
        `${result.firstname} ${result.lastname}`
      ]);
      result.gpas = gpaResults;
    }

    const totalResults = countResult[0].total;
    const totalPages = Math.ceil(totalResults / limit);

    console.log(`Search results for query "${query}":`, results);
    res.json({
      results: results,
      page: parseInt(page),
      limit: parseInt(limit),
      totalResults: totalResults,
      totalPages: totalPages
    });
  } catch (error) {
    console.error('Database query error:', error);
    if (error.code === 'ER_NO_SUCH_TABLE') {
      res.status(404).json({ error: 'Requested resource not found' });
    } else {
      res.status(500).json({ error: 'Database error: ' + error.message });
    }
  }
});

// Route handling for 'ratemycourse' related data
app.use('/api', spotDataUpload(dbRateMyCourse));

// Register route for main page (login_info table in 'mytables')
app.post('/register', (req, res) => {
  const { username, password, dob, country } = req.body;

  if (!username || !password || !dob || !country) {
    return res.status(400).json({ error: 'Please provide all required fields' });
  }

  const checkUserQuery = 'SELECT * FROM login_info WHERE username = ?';
  dbMytables.query(checkUserQuery, [username], (error, results) => {
    if (error) {
      console.error('Database query error:', error);
      return res.status(500).json({ error });
    }

    if (results.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const insertUserQuery = 'INSERT INTO login_info (username, password, dob, country) VALUES (?, ?, ?, ?)';
    dbMytables.query(insertUserQuery, [username, hashedPassword, dob, country], (error, results) => {
      if (error) {
        console.error('Database query error:', error);
        return res.status(500).json({ error: 'Database error' });
      }

      res.status(200).json({ message: 'Registration successful' });
    });
  });
});

// Register route for database access (users table in 'mytables')
app.post('/register-db', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Please provide both username and password' });
  }

  const checkUserQuery = 'SELECT * FROM users WHERE username = ?';
  dbMytables.query(checkUserQuery, [username], (error, results) => {
    if (error) {
      console.error('Database query error:', error);
      return res.status(500).json({ error });
    }

    if (results.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const insertUserQuery = 'INSERT INTO users (username, password) VALUES (?, ?)';
    dbMytables.query(insertUserQuery, [username, hashedPassword], (error, results) => {
      if (error) {
        console.error('Database query error:', error);
        return res.status(500).json({ error: 'Database error' });
      }

      res.status(200).json({ message: 'Registration successful' });
    });
  });
});

// Login route for main page (login_info table in 'mytables')
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Please provide both username and password' });
  }

  const checkUserQuery = 'SELECT * FROM login_info WHERE username = ?';
  dbMytables.query(checkUserQuery, [username], (error, results) => {
    if (error) {
      console.error('Database query error:', error);
      return res.status(500).json({ error: 'Database error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: 'User does not exist' });
    }

    const user = results[0];
    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Password incorrect' });
    }

    res.status(200).json({ message: 'Login successful' });
  });
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

// Login route for database access (users table in 'mytables')
app.post('/login-db', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Please provide both username and password' });
  }

  const checkUserQuery = 'SELECT * FROM users WHERE username = ?';
  dbMytables.query(checkUserQuery, [username], (error, results) => {
    if (error) {
      console.error('Database query error:', error);
      return res.status(500).json({ error: 'Database error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: 'User does not exist' });
    }

    const user = results[0];
    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Password incorrect' });
    }

    res.status(200).json({ message: 'Login successful' });
  });
});

// Server start
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
