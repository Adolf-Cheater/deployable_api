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
      const departmentResult = await queryPromise(db,
        'INSERT INTO departments (DepartmentName, Faculty) VALUES (?, ?) ON DUPLICATE KEY UPDATE DepartmentID=LAST_INSERT_ID(DepartmentID)',
        [department, faculty]
      );
      const departmentId = departmentResult.insertId;
      console.log('Department inserted/updated with ID:', departmentId); // Log department ID

      // Insert or get Course
      const courseResult = await queryPromise(db,
        'INSERT INTO courses (CourseCode, CourseName, DepartmentID) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE CourseID=LAST_INSERT_ID(CourseID)',
        [courseCode, courseCode, departmentId]
      );
      const courseId = courseResult.insertId;
      console.log('Course inserted/updated with ID:', courseId); // Log course ID

      // Insert or get Instructor
      const instructorResult = await queryPromise(db,
        'INSERT INTO instructors (FirstName, LastName, DepartmentID) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE InstructorID=LAST_INSERT_ID(InstructorID)',
        [instructorFirstName, instructorLastName, departmentId]
      );
      const instructorId = instructorResult.insertId;
      console.log('Instructor inserted/updated with ID:', instructorId); // Log instructor ID

      // Insert or get CourseOffering
      const offeringResult = await queryPromise(db,
        'INSERT INTO courseofferings (CourseID, InstructorID, AcademicYear, Semester, Section) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE OfferingID=LAST_INSERT_ID(OfferingID)',
        [courseId, instructorId, academicYear, courseType, section]
      );
      const offeringId = offeringResult.insertId;
      console.log('Course offering inserted/updated with ID:', offeringId); // Log offering ID

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
