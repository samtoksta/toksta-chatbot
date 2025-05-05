import { createClient } from '@supabase/supabase-js';

// Ensure environment variables are defined
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error('Missing environment variable: NEXT_PUBLIC_SUPABASE_URL');
}
if (!supabaseAnonKey) {
  throw new Error('Missing environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

// Create and export the Supabase client instance
// We use NEXT_PUBLIC_ variables because this client might be used
// in both client-side and server-side components/routes.
// For server-only operations requiring higher privileges later,
// we might create a separate service role client.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Optionally, you can define types for your database schema here
// using `supabase gen types typescript > src/lib/database.types.ts`
// and pass it to createClient for better type safety:
// import { Database } from './database.types';
// export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey); 