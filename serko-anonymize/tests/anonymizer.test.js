'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Anonymizer = require('../js/anonymizer.js');
const Validators = require('../js/validators.js');

function anonymize(text, types, options = {}) {
  return Anonymizer.anonymize(text, { mode: 'mask', types, ...options });
}

function typesOf(result) {
  return result.matches.map((match) => match.type);
}

test('маскирует основные персональные данные', () => {
  const cases = [
    ['fio', 'Гражданин Иванов Иван Иванович заключил договор.'],
    ['dob', 'Дата рождения: 01.02.1990.'],
    ['address', 'Адрес: г. Москва, ул. Ленина, д. 5, кв. 10.'],
    ['phone', 'Телефон: +7 (916) 123-45-67.'],
    ['email', 'Email: ivan@example.com.'],
    ['passport_ru', 'Паспорт серия 45 06 № 123456.'],
    ['passport_by', 'Паспорт серия KB № 1234567.'],
    ['personal_id_by', 'Личный номер 0102900B002PB5.'],
    ['doc', 'Водительское удостоверение 77 АА № 123456.'],
    ['polis', 'Полис ОСАГО серии ХХХ № 1234567890.'],
    ['inn', 'ИНН 7707083893.'],
    ['snils', 'СНИЛС 112-233-445 95.'],
    ['ogrn', 'ОГРН 1027700132195.'],
    ['unp', 'УНП 101541906.'],
    ['iban', 'Счёт BY03 ALFA 3014 1234 5678 9012.'],
    ['card', 'Карта 4111 1111 1111 1111.'],
    ['company', 'ООО «Весна» заключило договор.'],
    ['money', 'Сумма 250 000,00 рублей.'],
    ['vehicle', 'Госномер А123ВЕ77.'],
    ['ip', 'IP-адрес 192.168.1.10.'],
    ['url', 'Сайт https://example.com/path.']
  ];

  for (const [type, text] of cases) {
    const result = anonymize(text, [type]);
    assert.ok(typesOf(result).includes(type), `${type}: совпадение не найдено в «${text}»`);
    assert.ok(result.result.includes('['), `${type}: замена не выполнена`);
  }
});

test('не маскирует отключённые типы', () => {
  const text = 'ИНН 7707083893, телефон +7 (916) 123-45-67.';
  const result = anonymize(text, ['phone']);
  assert.deepEqual(typesOf(result), ['phone']);
  assert.ok(result.result.includes('7707083893'));
  assert.ok(!result.result.includes('+7 (916)'));
});

test('выбор паспортов не зависит от категории ВУ/СТС/ПТС', () => {
  const text = 'Паспорт серия 45 06 № 123456. Водительское удостоверение 77 АА № 123456.';
  const docOnly = anonymize(text, ['doc']);
  assert.deepEqual(typesOf(docOnly), ['doc']);
  assert.ok(docOnly.result.includes('45 06 № 123456'));

  const passportOnly = anonymize(text, ['passport_ru']);
  assert.deepEqual(typesOf(passportOnly), ['passport_ru']);
  assert.ok(passportOnly.result.includes('77 АА № 123456'));
});

test('сохраняет номера дел, статей и договоров', () => {
  const text = 'Договор № 15/2025 по делу № 2-1234/2025, ст. 393 ГК РФ.';
  const result = anonymize(text, ['passport_ru', 'inn', 'snils', 'bank_account', 'phone', 'dob']);
  assert.equal(result.result, text);
});

test('режим восстановления возвращает исходный текст без потерь', () => {
  const text = 'Иванов Иван Иванович, ИНН 500100732259, email ivan@example.com.';
  const result = anonymize(text, ['fio', 'inn', 'email'], { mode: 'reversible' });
  assert.equal(Anonymizer.restore(result.result, result.map), text);
});

test('повторные данные одной персоны получают один плейсхолдер', () => {
  const text = 'Иванов Иван Иванович заключил договор. Подпись: Иванов И.И.';
  const result = anonymize(text, ['fio']);
  const placeholders = result.result.match(/\[ФИО-\d+\]/g) || [];
  assert.equal(placeholders.length, 2);
  assert.equal(new Set(placeholders).size, 1);
});

test('пользовательские и стоп-слова применяются', () => {
  const custom = anonymize('Доверитель Василюк передал документ.', ['fio'], { customWords: ['Василюк'] });
  assert.ok(!custom.result.includes('Василюк'));

  const stopped = anonymize('Гражданин Иванов Иван Иванович.', ['fio'], { stopWords: ['Иванов'] });
  assert.ok(stopped.result.includes('Иванов'));
});

test('валидаторы принимают корректные контрольные суммы', () => {
  assert.equal(Validators.isValidINN('7707083893'), true);
  assert.equal(Validators.isValidINN('500100732259'), true);
  assert.equal(Validators.isValidSNILS('112-233-445 95'), true);
  assert.equal(Validators.isValidOGRN('1027700132195'), true);
  assert.equal(Validators.isValidUNP('101541906'), true);
  assert.equal(Validators.isValidCard('4111 1111 1111 1111'), true);
  assert.equal(Validators.isValidIBAN('BY03 ALFA 3014 1234 5678 9012'), true);
});

test('валидаторы отклоняют некорректные форматы', () => {
  assert.equal(Validators.isValidINN('7707083892'), false);
  assert.equal(Validators.isValidSNILS('112-233-445 96'), false);
  assert.equal(Validators.isValidOGRN('1027700132194'), false);
  assert.equal(Validators.isValidUNP('101541907'), false);
  assert.equal(Validators.isValidCard('4111 1111 1111 1112'), false);
  assert.equal(Validators.isValidIBAN('BY04 ALFA 3014 1234 5678 9012'), false);
  assert.equal(Validators.isValidPersonalIdBY('3102900B002PB5'), false);
  assert.equal(Validators.isPlausiblePassportBY('ZZ', '1234567'), false);
});

test('КПП с буквами в разрядах причины постановки распознаётся', () => {
  assert.equal(Validators.isValidKPP('7707AB001'), true);
  const result = anonymize('КПП 7707AB001.', ['ogrn', 'kpp']);
  assert.ok(typesOf(result).includes('kpp'));
  assert.ok(!result.result.includes('7707AB001'));
});

test('некорректный IPv4 не маскируется как IP-адрес', () => {
  const result = anonymize('Версия 999.888.777.666 не является IP.', ['ip']);
  assert.equal(result.matches.length, 0);
  assert.equal(result.result, 'Версия 999.888.777.666 не является IP.');
});

test('пунктуация после URL остаётся в исходном тексте', () => {
  const result = anonymize('Сайт (https://example.com/path).', ['url']);
  assert.ok(result.result.endsWith(').'), result.result);
});

test('дата договора рядом с датой рождения сохраняется', () => {
  const text = 'Дата рождения: 01.02.1990. Дата договора: 03.04.2024.';
  const result = anonymize(text, ['dob']);
  assert.ok(!result.result.includes('01.02.1990'));
  assert.ok(result.result.includes('03.04.2024'));
});

function expectedAccountKey(bik, account) {
  const prefix = bik.slice(4, 6) === '00' ? '0' + bik.slice(4, 6) : bik.slice(-3);
  const value = prefix + account;
  const weights = [7, 1, 3];
  let sum = 0;
  for (let i = 0; i < value.length; i++) sum += (Number(value[i]) * weights[i % 3]) % 10;
  return sum % 10 === 0;
}

function makeAccount(bik) {
  const base = '40817810000000000000';
  for (let check = 0; check <= 9; check++) {
    const account = base.slice(0, 8) + check + base.slice(9);
    if (expectedAccountKey(bik, account)) return account;
  }
  throw new Error('Не удалось построить тестовый счёт');
}

test('ключевание счёта использует правильные разряды БИК', () => {
  for (const bik of ['044525225', '040000123']) {
    const account = makeAccount(bik);
    assert.equal(Validators.isValidBankAccount(account, bik), true, `${account}, БИК ${bik}`);
  }
});

test('псевдонимы не оставляют исходную денежную сумму', () => {
  const text = 'Сумма 250 000,00 рублей.';
  const result = anonymize(text, ['money'], { mode: 'pseudonym' });
  assert.notEqual(result.result, text);
  assert.ok(!result.result.includes('250 000,00'));
  assert.ok(result.result.includes('рублей'));
});

test('банковские карты длиной 13–19 цифр распознаются', () => {
  const text = 'Карта 2200 0000 0000 0000 004.';
  assert.equal(Validators.isValidCard('2200000000000000004'), true);
  const result = anonymize(text, ['card']);
  assert.ok(typesOf(result).includes('card'));
  assert.ok(!result.result.includes('2200 0000 0000 0000 004'));
});
