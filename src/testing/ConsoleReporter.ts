export class ConsoleReporter {
  static title(text: string) {
    console.log('\n==================================================');
    console.log(`🧪 ${text}`);
    console.log('==================================================\n');
  }

  static section(text: string) {
    console.log(`\n📌 ${text}`);
    console.log('--------------------------------------------------');
  }

  static step(text: string) {
    console.log(`➡️  ${text}`);
  }

  static success(text: string) {
    console.log(`✅ ${text}`);
  }

  static error(text: string) {
    console.log(`❌ ${text}`);
  }

  static table(data: unknown[]) {
    // Use a one-based display index; never confuse it with database IDs.
    console.table(Object.fromEntries(data.map((row, index) => [index + 1, row])));
  }
}