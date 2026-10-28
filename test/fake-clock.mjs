// 시험용: 자식 프로세스(node --import)의 현재 시각을 FAKE_NOW(ISO)부터 흐르게 한다 (node --test 대상 아님)
const fake = Date.parse(process.env.FAKE_NOW || '');
if (!Number.isNaN(fake)) {
  const RealDate = Date;
  const start = RealDate.now();
  const now = () => fake + (RealDate.now() - start);
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [now()]));
    }

    static now() {
      return now();
    }
  };
}
