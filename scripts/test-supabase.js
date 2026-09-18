import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// Parse .env manually
const envContent = readFileSync('.env', 'utf-8');
const envConfig = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || '';
    if (value.length > 0 && value.startsWith('"') && value.endsWith('"')) {
      value = value.substring(1, value.length - 1);
    }
    envConfig[match[1]] = value.trim();
  }
});

const url = envConfig.VITE_SUPABASE_URL;
const anonKey = envConfig.VITE_SUPABASE_ANON_KEY;
const serviceKey = envConfig.SUPABASE_SERVICE_ROLE_KEY;

console.log('Testing Supabase connection...');
console.log('URL:', url);

async function testConnection() {
  try {
    const supabaseAnon = createClient(url, anonKey);
    const supabaseAdmin = createClient(url, serviceKey);

    // Test Anon client ping (e.g. check system health / auth)
    const { error: authError } = await supabaseAnon.auth.getSession();
    if (authError) {
      console.error('Anon client auth check error:', authError.message);
    } else {
      console.log('✅ Anon client connected successfully!');
    }

    // Test Service Role client ping
    const { error: healthError } = await supabaseAdmin.from('_dummy_table_test_').select('*').limit(1);
    if (healthError) {
      if (healthError.code === '42P01' || healthError.message.includes('relation') || healthError.message.includes('does not exist')) {
        console.log('✅ Service Role client authenticated successfully! (Database online & ready for migrations)');
      } else {
        console.log('Service Role response:', healthError);
      }
    } else {
      console.log('✅ Service Role client connected successfully!');
    }
  } catch (err) {
    console.error('❌ Connection error:', err);
  }
}

testConnection();
