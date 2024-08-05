const express = require('express');
const router = express.Router();

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

module.exports = function(db) {
  router.post('/submitSpotData', async (req, res) => {
    console.log('Received data:', req.body); // Log received data

    const { 
      academicYear, courseCode, courseType, section, 
      instructorFirstName, instructorLastName, department, faculty, 
      classSize, responseCount, processDate, questions = [] // Default to an empty array if questions is undefined
    } = req.body;

    // Basic validation
    if (!academicYear || !courseCode || !instructorFirstName || !instructorLastName) {
      console.error('Missing required fields'); // Log missing fields
      return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
      // Start a transaction
      await queryPromise(db, 'START TRANSACTION');

      // Insert or get Department
      const [departmentRow] = await queryPromise(db,
        'SELECT DepartmentID FROM departments WHERE DepartmentName = ? AND Faculty = ?',
        [department, faculty]
      );
      let departmentId;
      if (departmentRow) {
        departmentId = departmentRow.DepartmentID;
      } else {
        const result = await queryPromise(db,
          'INSERT INTO departments (DepartmentName, Faculty) VALUES (?, ?)',
          [department, faculty]
        );
        departmentId = result.insertId;
      }
      console.log('Department ID:', departmentId); // Log department ID

      // Insert or get Instructor
      const [instructorRow] = await queryPromise(db,
        'SELECT InstructorID FROM instructors WHERE FirstName = ? AND LastName = ? AND DepartmentID = ?',
        [instructorFirstName, instructorLastName, departmentId]
      );
      let instructorId;
      if (instructorRow) {
        instructorId = instructorRow.InstructorID;
      } else {
        const result = await queryPromise(db,
          'INSERT INTO instructors (FirstName, LastName, DepartmentID) VALUES (?, ?, ?)',
          [instructorFirstName, instructorLastName, departmentId]
        );
        instructorId = result.insertId;
      }
      console.log('Instructor ID:', instructorId); // Log instructor ID

      // Insert or get CourseOffering
      const [offeringRow] = await queryPromise(db,
        'SELECT OfferingID FROM courseofferings WHERE CourseID = ? AND InstructorID = ? AND AcademicYear = ? AND Semester = ? AND Section = ?',
        [courseId, instructorId, academicYear, courseType, section]
      );
      let offeringId;
      if (offeringRow) {
        offeringId = offeringRow.OfferingID;
      } else {
        const result = await queryPromise(db,
          'INSERT INTO courseofferings (CourseID, InstructorID, AcademicYear, Semester, Section) VALUES (?, ?, ?, ?, ?)',
          [courseId, instructorId, academicYear, courseType, section]
        );
        offeringId = result.insertId;
      }
      console.log('Course offering ID:', offeringId); // Log offering ID

      // Insert SPOT_Ratings
      const ratingResult = await queryPromise(db,
        'INSERT INTO spot_ratings (OfferingID, EnrollmentCount, ResponseCount, LastUpdated) VALUES (?, ?, ?, ?)',
        [offeringId, classSize, responseCount, processDate]
      );
      const ratingId = ratingResult.insertId;
      console.log('SPOT rating inserted with ID:', ratingId); // Log rating ID

      // Insert SPOT_Questions
      if (Array.isArray(questions) && questions.length > 0) {
        for (let question of questions) {
          await queryPromise(db,
            'INSERT INTO spot_questions (RatingID, QuestionText, StronglyDisagree, Disagree, Neither, Agree, StronglyAgree, Median) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [ratingId, question.text, parseInt(question.stronglyDisagree), parseInt(question.disagree), parseInt(question.neither), parseInt(question.agree), parseInt(question.stronglyAgree), parseFloat(question.median)]
          );
          console.log('SPOT question inserted:', question.text); // Log each question inserted
        }
      } else {
        console.warn('Questions is not an array or is missing. Questions:', questions);
      }

      // Commit the transaction
      await queryPromise(db, 'COMMIT');
      console.log('Transaction committed successfully');

      res.status(200).json({ message: 'SPOT data uploaded successfully' });
    } catch (error) {
      // Rollback the transaction in case of error
      await queryPromise(db, 'ROLLBACK');
      console.error('Error uploading SPOT data:', error);
      res.status(500).json({ error: 'Error uploading SPOT data: ' + error.message });
    }
  });

  return router;
};
