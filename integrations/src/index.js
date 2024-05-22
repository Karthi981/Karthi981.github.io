import express from 'express';
import { z, ZodError } from 'zod';

import sheets from './sheetClient.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 5000;

const formSchema = z.object({
  name: z.string().min(1, { message: 'Name is required' }),
  email: z.string().email(),
  message: z.string().min(1, { message: 'Message is required' }),
  sheet_url: z.string().min(1, { message: 'Sheet Url is required' }),
  range: z.string().optional(),
});

app.listen(PORT, () => {
  console.log('Server Listening on PORT:', PORT);
});

app.get('/status', (req, res) => {
  res.send({ Status: 'Running' });
});

app.post('/add-entry', async (req, res) => {
  try {
    const body = formSchema.parse(req.body);
    const { name, email, message, sheet_url, range } = body;

    // Extract sheet ID from the URL
    const sheetIdMatch = sheet_url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!sheetIdMatch || !sheetIdMatch[1]) {
      return res.status(400).json({ error: 'Invalid Google Sheets URL' });
    }
    const sheetID = sheetIdMatch[1];
    console.log('sheetId:', sheetID);

    // Use the provided range or default to 'Sheet1!A:D'
    const rangeToUse = range || 'Sheet1!A:D';
    const date = new Date();
    const formattedDate = date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    const rows = [name, email, message, formattedDate];
    console.log(rows);

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetID,
      range: rangeToUse,
      insertDataOption: 'INSERT_ROWS',
      valueInputOption: 'RAW',
      requestBody: {
        values: [rows],
      },
    });
    res.json({ message: 'Data added successfully' });
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ error: error.errors.map((e) => e.message) });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});
