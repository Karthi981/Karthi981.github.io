import dotenv from 'dotenv';
import express from 'express';
import { z, ZodError } from 'zod';
import { google } from 'googleapis';
import fs from 'fs/promises';
import dayjs from 'dayjs';
import { Client } from '@notionhq/client';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

let spreadsheetId = '';
let sheet_range = '';

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const notionUrl =
  'https://www.notion.so/554056af423547a19703d56b1f2d40d6?v=45ff18e6adf442ab88dbb09e056ba65c';
const NOTION_DATABASE_ID = extractDatabaseId(notionUrl);

const scopes = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/calendar',
];

const formSchema = z.object({
  name: z.string().min(3, { message: 'Name is required' }),
  email: z.string().email(),
  message: z.string().min(1, { message: 'Message is required' }),
  sheet_url: z.string().min(1, { message: 'Sheet Url is required' }),
  range: z.string().optional(),
});

// Load client secrets from a local file.
const CREDENTIALS_PATH = 'credentials.json';
const TOKEN_PATH = 'token.json';

// Scopes for reading and writing to Google Sheets
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const checkAuth = async (req, res, next) => {
  try {
    const token = await fs.readFile(TOKEN_PATH);
    oauth2Client.setCredentials(JSON.parse(token));
    next();
  } catch (err) {
    console.log('Please login to Google for access');
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
    });
    res.status(401).json({ message: 'Please login to Google for access', url });
  }
};

app.listen(PORT, () => {
  console.log('Server Listening on PORT:', PORT);
});

app.get('/status', (req, res) => {
  res.send({ Status: 'Running' });
});

app.get('/auth/callback', async (req, res) => {
  const code = req.query.code; // Get the authorization code from the query parameters
  if (!code) {
    return res.status(400).send('Authorization code not found.');
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    await saveToken(tokens);
    res.json({ token: tokens, message: 'Logged in successfully' });
  } catch (err) {
    console.error('Error retrieving access token:', err);
    res.status(500).send('Error retrieving access token.');
  }
});

app.get('/login/google', async (req, res) => {
  try {
    const token = await fs.readFile(TOKEN_PATH);
    oauth2Client.setCredentials(JSON.parse(token));
    res.json({
      token: JSON.parse(token),
      message: 'Logged in successfully without auth',
    });
  } catch (err) {
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      redirect_uri: process.env.REDIRECT_URI,
    });
    res.redirect(url);
  }
});

app.post('/add-entry', checkAuth, async (req, res) => {
  try {
    const body = formSchema.parse(req.body);
    const { name, email, message, sheet_url, range } = body;

    // Extract sheet ID from the URL
    const sheetIdMatch = sheet_url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!sheetIdMatch || !sheetIdMatch[1]) {
      return res.status(400).json({ error: 'Invalid Google Sheets URL' });
    }
    const sheetId = sheetIdMatch[1];
    spreadsheetId = sheetId;

    // Use the provided range or default to 'Data!A:C'
    const rangeToUse = range || 'Data!A2:D';
    sheet_range = rangeToUse;

    // Authorize a client with credentials, then call the Google Sheets API.
    await appendData(
      oauth2Client,
      sheetId,
      rangeToUse,
      res,
      name,
      email,
      message
    );
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ error: error.errors.map((e) => e.message) });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

async function appendData(
  auth,
  spreadsheetId,
  range,
  res,
  name,
  email,
  message
) {
  const date = new Date();
  const formattedDate = dayjs(date).format('YYYY-MM-DD'); // Format date to ISO 8601 as notion date format validates as ISO 8601

  const rows = [name, email, message, formattedDate];
  const values = [rows];

  const sheets = google.sheets({ version: 'v4', auth });
  const calendar = google.calendar({ version: 'v3', auth });

  try {
    await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: `Invite from ${email}`,
        description: `${message}`,
        start: {
          dateTime: dayjs(new Date()).add(1, 'day').toISOString(),
          timeZone: 'America/Los_Angeles',
        },
        end: {
          dateTime: dayjs(new Date())
            .add(1, 'day')
            .add(1, 'hour')
            .toISOString(),
          timeZone: 'America/Los_Angeles',
        },
      },
    });

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values,
      },
    });

    res.json({ message: 'Data added successfully' });
  } catch (err) {
    console.error('Error appending data to sheet:', err);
    res.status(500).json({ error: err.message });
  }
}

async function saveToken(token) {
  await fs.writeFile(TOKEN_PATH, JSON.stringify(token));
  console.log('Token stored to', TOKEN_PATH);
}

function extractDatabaseId(url) {
  const urlParts = url.split('/');
  const database_id = urlParts[urlParts.length - 1].split('?')[0];
  console.log('database_id :', database_id);
  return database_id;
}

async function addToNotion(row) {
  try {
    await notion.pages.create({
      parent: { database_id: NOTION_DATABASE_ID },
      properties: {
        Name: {
          title: [
            {
              text: {
                content: row[0],
              },
            },
          ],
        },
        Email: {
          email: row[1],
        },
        Description: {
          rich_text: [
            {
              text: {
                content: row[2],
              },
            },
          ],
        },
        Date: {
          date: {
            start: row[3],
          },
        },
      },
    });
    console.log('Added to Notion:', row);
  } catch (err) {
    console.error('Error adding to Notion:', err);
  }
}

async function monitorSheet(auth) {
  const sheets = google.sheets({ version: 'v4', auth });

  let lastRowCount = 0;

  setInterval(async () => {
    if (!spreadsheetId || !sheet_range) {
      console.log('Api not invoked : Invoke Api to set sheetId and range');
      return;
    }
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: sheet_range,
      });
      const rows = res.data.values;
      if (rows && rows.length > lastRowCount) {
        rows.slice(lastRowCount).forEach((row) => {
          const message = `New entry: ${row.join(', ')}`;
          console.log(row);
          addToNotion(row);
          console.log(message);
        });
        lastRowCount = rows.length;
      } else if (!rows || !rows.length) {
        console.log('No data found.');
      }
    } catch (err) {
      console.log('The API returned an error:', err);
    }
  }, 1200);
}

async function main() {
  try {
    monitorSheet(oauth2Client);
  } catch (err) {
    console.error('Error:', err);
  }
}

main();
