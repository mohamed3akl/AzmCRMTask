import 'dotenv/config';
import { createApp } from './app';

const PORT = process.env.PORT ?? 4000;
const app = createApp();

app.listen(PORT, () => {
  console.log(`AzmCRM backend listening on port ${PORT}`);
});
