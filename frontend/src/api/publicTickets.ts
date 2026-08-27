import axios from 'axios';

const publicApiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api',
});

export async function submitPublicTicket(data: {
  fullName: string;
  email?: string;
  phone?: string;
  subject: string;
  description: string;
}): Promise<{ reference: string }> {
  const res = await publicApiClient.post('/public/tickets', data);
  return res.data;
}
