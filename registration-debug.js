// Registration Debug Script
// This script helps debug registration issues in the Toko application

// Common Registration Issues:
// 1. Empty or malformed JSON responses from the server
// 2. Database connection issues
// 3. Missing environment variables
// 4. Missing required fields in the request
// 5. CORS issues

// To debug registration issues:

// 1. Check for DATABASE_URL environment variable
if (!process.env.DATABASE_URL) {
  console.warn('DATABASE_URL is not set. The application will use in-memory storage.');
  console.warn('This is fine for testing, but user data will be lost when the server restarts.');
}

// 2. Test the database connection
async function testDatabaseConnection() {
  try {
    const { Pool } = require('@neondatabase/serverless');
    const pool = new Pool({ 
      connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/toko_dev' 
    });
    
    const client = await pool.connect();
    console.log('✓ Database connection successful');
    
    await client.query('SELECT NOW()');
    console.log('✓ Database query executed successfully');
    
    client.release();
  } catch (error) {
    console.error('✗ Database connection error:', error.message);
    console.warn('The application will use in-memory storage as a fallback.');
  }
}

// 3. Test user registration
async function testUserRegistration() {
  try {
    const response = await fetch('http://localhost:5001/api/v1/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: `test_${Date.now()}@example.com`,
        password: 'password123',
        name: 'Test User',
        provider: 'local'
      }),
    });
    
    console.log('Response status:', response.status);
    console.log('Response headers:', {
      contentType: response.headers.get('content-type'),
      contentLength: response.headers.get('content-length')
    });
    
    try {
      const text = await response.text();
      console.log('Raw response text:', text);
      
      if (text) {
        try {
          const json = JSON.parse(text);
          console.log('Parsed JSON response:', json);
        } catch (parseError) {
          console.error('Failed to parse response as JSON:', parseError.message);
        }
      } else {
        console.warn('Empty response body');
      }
    } catch (textError) {
      console.error('Failed to get response text:', textError.message);
    }
  } catch (error) {
    console.error('Test registration failed:', error.message);
  }
}

// 4. Check for memory leaks or excessive memory usage
function checkMemoryUsage() {
  const used = process.memoryUsage();
  
  console.log('Memory usage:');
  for (const key in used) {
    console.log(`  ${key}: ${Math.round(used[key] / 1024 / 1024 * 100) / 100} MB`);
  }
}

// Instructions to use this debug script:
// 1. Make sure the server is running
// 2. In a separate terminal, run: node registration-debug.js
// 3. Check the output for any errors or warnings

console.log('=== Toko Registration Debug Tool ===');
console.log('To use this debug tool:');
console.log('1. Start the server in one terminal: npm run server');
console.log('2. Run this script in another terminal: node registration-debug.js');
console.log('3. Alternatively, use the provided test functions in a Node REPL');
console.log('\nExported functions:');
console.log('- testDatabaseConnection(): Test the database connection');
console.log('- testUserRegistration(): Test the user registration endpoint');
console.log('- checkMemoryUsage(): Check the memory usage of the process');

// Export functions for use in a Node REPL
if (typeof module !== 'undefined') {
  module.exports = {
    testDatabaseConnection,
    testUserRegistration,
    checkMemoryUsage
  };
}
