// Test file to verify database module imports and functionality
import { 
  databaseManager, 
  executeQuery, 
  isDbConnected,
  getDbHealthStatus,
  DatabaseManager,
  DatabaseError
} from './database.js';

console.log('✅ Database module imports successfully');
console.log('✅ DatabaseManager class:', typeof DatabaseManager);
console.log('✅ DatabaseError class:', typeof DatabaseError);
console.log('✅ databaseManager instance:', typeof databaseManager);
console.log('✅ executeQuery function:', typeof executeQuery);
console.log('✅ isDbConnected function:', typeof isDbConnected);
console.log('✅ getDbHealthStatus function:', typeof getDbHealthStatus);

// Test basic functionality
console.log('Database connected:', isDbConnected());

export { databaseManager };
