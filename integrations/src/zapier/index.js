import express from 'express';
import cors from 'cors';

const app = express();
const port = 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Allow CORS only from Zapier
app.use(
  cors({
    origin: [
      'https://www.google.co.in',
      'https://google.com',
      'https://zapier.com/',
      'https://www.yellowcourse.com/',
    ], // Add more origins as needed
  })
);

let formSubmissions = [];

// Route to handle form submissions
app.post('/api/zapier-form-submissions', (req, res) => {
  // Extract form data from the request body
  console.log(req);
  const { name, email, description, date } = req.body;

  // Create a new form submission object
  const submission = { name, email, description, date };

  // Add the submission to the formSubmissions array
  formSubmissions.push(submission);

  // Send a response indicating successful form submission
  res.status(200).json({ message: 'Form submitted successfully' });
});

// Route to retrieve stored form submissions
app.get('/api/zapier-integration', (req, res) => {
  console.log(req);
  // Send the stored form submissions as JSON response
  res.json({ content: formSubmissions });
});

const forms = [
  { id: 1, name: 'Form 1' },
  { id: 2, name: 'Form 2' },
  { id: 3, name: 'Form 3' },
];

// Define a route to handle GET requests for forms
app.get('/api/forms', (req, res) => {
  // Return the forms data as JSON
  console.log(req.url);
  res.json({ content: forms });
});

// app.get('/', (req, res) => {
//   res
//     .status(200)
//     .json({ status: `Server is listening at http://localhost:${port}` });
// });
// Start the server
app.listen(port, () => {
  console.log(`Server is listening at http://localhost:${port}`);
});
