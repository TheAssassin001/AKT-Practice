// supabase.js
import { createClient } from 'https://esm.sh/@supabase/supabase-js';

// ============================================================
// SECURITY DOCUMENTATION
// ============================================================
// 
// ⚠️ IMPORTANT: API Key Exposure
// The Supabase URL and anon key below are exposed in client-side code.
// This is INTENTIONAL and SAFE **only if** you implement proper security:
//
// 1. ROW LEVEL SECURITY (RLS) - CRITICAL
//    - You MUST enable RLS on all tables in Supabase
//    - Create policies that restrict data access appropriately
//    - Example policy for public read-only questions:
//      CREATE POLICY "Public questions are viewable by everyone"
//      ON questions FOR SELECT
//      USING (true);
//
// 2. AUTHENTICATION (Required for production)
//    - Implement user authentication before deploying
//    - Restrict write operations to authenticated users only
//    - Track user progress per authenticated user
//
// 3. CURRENT STATE
//    - Questions table: Should be read-only for anonymous users
//    - User progress: Currently stored in localStorage (insecure)
//    - TODO: Move user data to Supabase with proper auth
//
// 4. WHY THIS IS SAFE (for now)
//    - The anon key can only do what RLS policies allow
//    - If RLS is properly configured, anonymous users can only read questions
//    - No sensitive data should be in the questions table
//
// 5. BEFORE PRODUCTION DEPLOYMENT
//    ✓ Enable RLS on all tables
//    ✓ Create appropriate policies
//    ✓ Implement user authentication
//    ✓ Test that anonymous users cannot modify data
//    ✓ Move user progress tracking to authenticated backend
//
// For more info: https://supabase.com/docs/guides/auth/row-level-security
// ============================================================

export const supabase = createClient(
  'https://psrriircbmsrghwngite.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzcnJpaXJjYm1zcmdod25naXRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2NzYxNTksImV4cCI6MjA4NDI1MjE1OX0.1MdzhYucyG8NO6rs6xOM7vJkvGhWhz8dWnvy7fYy83g'
);

async function testSupabaseConnection() {
  try {
    const { data, error } = await supabase
      .from('questions')
      .select('*')
      .limit(1)
      .single();
    if (error) {
      console.error('Supabase error:', error);
    } else {
      console.log('Fetched row:', data);
    }
  } catch (err) {
    console.error('Unexpected error:', err);
  }
}

// Call the function to test connectivity
// Remove or comment out after testing
// testSupabaseConnection();
