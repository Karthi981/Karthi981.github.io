import dotenv from 'dotenv';
import express from 'express';
import { z, ZodError } from 'zod';
import { Client } from '@notionhq/client';

import fs from 'fs/promises';
import dayjs from 'dayjs';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8000;

const NOTION_AUTH_URL = process.env.NOTION_AUTH_URL;
const clientId = process.env.NOTION_OAUTH_CLIENT_ID;
const clientSecret = process.env.NOTION_OAUTH_CLIENT_SECRET;
const redirectUri = process.env.NOTION_OAUTH_REDIRECT_URI;

const notion = new Client({ auth: process.env.NOTION_API_KEY });

const TOKEN_PATH = 'notion-token.json';

const formSchema = z.object({
  name: z.string().min(3, { message: 'Name is required' }),
  email: z.string().email(),
  message: z.string().min(1, { message: 'Message is required' }),
});

app.listen(PORT, () => {
  console.log('Server Listening on PORT:', PORT);
});

app.get('/api/notion-login', (req, res) => {
  res
    .status(200)
    .json({ message: 'Please login to Notion for access', NOTION_AUTH_URL });
});

app.get('/auth/notion-callback', async (req, res) => {
  const code = req.query.code; // Get the authorization code from the query parameters
  if (!code) {
    return res.status(400).send('Authorization code not found.');
  }
  try {
    const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString(
      'base64'
    );

    const response = await fetch('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Basic ${encoded}`,
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: `${code}`,
        redirect_uri: redirectUri,
      }),
    });
    const data = await response.json();
    await saveToken(data);
    res.json({ tokens: data, message: 'Logged in successfully' });
  } catch (err) {
    res.status(500).send(`Error retrieving access token.${err}`);
  }
});

const checkAuth = async (req, res, next) => {
  try {
    const tokens = await fs.readFile(TOKEN_PATH);
    next();
  } catch (err) {
    console.log('Please login to Notion for access');

    res
      .status(401)
      .json({ message: 'Please login to Notion for access', NOTION_AUTH_URL });
  }
};

app.post('/api/add-notion-entry', checkAuth, async (req, res) => {
  try {
    const body = formSchema.parse(req.body);
    const { name, email, message } = body;

    const tokens = await fs.readFile(TOKEN_PATH);
    const parsedToken = JSON.parse(tokens);
    const access_token = parsedToken.access_token;
    console.log('Access Token :', access_token);
    const response = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        authorization: `Bearer ${access_token}`,
      },
    });
    const data = await response.json();

    const targetTitle = 'Google Integration';
    const databaseId = getDatabaseIdByTitle(data, targetTitle);
    let notion_database_id = '';
    if (databaseId) {
      notion_database_id = databaseId;
      console.log(`Database ID for "${targetTitle}": ${databaseId}`);
    } else {
      console.log(`Database with title "${targetTitle}" not found.`);
      res
        .status(401)
        .json({ message: 'Database with title "${targetTitle}" not found.' });
    }

    const date = new Date();
    const formattedDate = dayjs(date).format('YYYY-MM-DD'); // Format date to ISO 8601 as notion date format validates as ISO 8601

    const row = [name, email, message, formattedDate];

    console.log(row);
    const client_response = await addToNotion(
      row,
      notion_database_id,
      access_token
    );

    res.status(200).json({ message: client_response });
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ error: error.errors.map((e) => e.message) });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

async function saveToken(token) {
  await fs.writeFile(TOKEN_PATH, JSON.stringify(token));
  console.log('Token stored to', TOKEN_PATH);
}

async function addToNotion(row, notion_database_id, access_token) {
  const headers = {
    Authorization: `Bearer ${access_token}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2021-08-16',
  };

  const payload = {
    parent: { database_id: notion_database_id },
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
  };

  try {
    const response = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(`Notion API error: ${result.message}`);
    }
    console.log('Added to Notion:', result);
    return result;
  } catch (err) {
    console.error('Error adding to Notion:', err);
    throw err;
  }
}
// Function to extract the database_id of the title "Google Integration"
function getDatabaseIdByTitle(responseObject, targetTitle) {
  for (const result of responseObject.results) {
    if (result.object === 'database') {
      const titleArray = result.title;
      if (titleArray.length > 0 && titleArray[0].plain_text === targetTitle) {
        return result.id;
      }
    }
  }
  return null; // Return null if the title is not found
}
