BEGIN;
SET LOCAL standard_conforming_strings = on;
LOCK TABLE maikuro.suppliers, maikuro.stores, maikuro.products IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM maikuro.products) OR EXISTS (SELECT 1 FROM maikuro.stores) OR EXISTS (SELECT 1 FROM maikuro.suppliers) THEN RAISE EXCEPTION 'Seed requires empty maikuro master tables'; END IF; END $$;
INSERT INTO maikuro.suppliers (supplier_id, name, city) VALUES
('SUP-01', '武蔵野珈琲・菓子商会', '東京都三鷹市'),
('SUP-02', '相模焙煎工房', '神奈川県相模原市'),
('SUP-03', '蔵前珈琲焙煎所', '東京都台東区'),
('SUP-04', '房総飲料工房', '千葉県市原市'),
('SUP-05', '駿河茶葉商会', '静岡県静岡市');

INSERT INTO maikuro.stores (store_id, name, city, cold_equipment, cups_per_day) VALUES
('STR-04', '神田店', '東京都千代田区', true, 200),
('STR-02', '中目黒店', '東京都目黒区', true, 100),
('STR-01', '吉祥寺店', '東京都武蔵野市', true, 120),
('STR-03', '浦和店', '埼玉県さいたま市浦和区', NULL, NULL),
('STR-05', '大宮店', '埼玉県さいたま市大宮区', true, 150),
('STR-06', '横浜みなとみらい店', '神奈川県横浜市西区', true, 150);

INSERT INTO maikuro.products (product_id, name, category, price_ex_tax, tax_percent, volume, supplier_id, display_order, attributes, data_origin) VALUES
('BEAN-001', '舞黒 深煎りブレンド', 'beans', 1200, 8, '200 g', NULL, 0, '{"english":"HOUSE BLEND / DARK","packLabel":"舞黒深煎り","packTone":"ink","origin":"ブラジル・コロンビア","roast":"深煎り","process":"ナチュラル・ウォッシュト","acidity":1,"body":5,"sweet":null,"bitter":5,"aroma":4,"brew":"ネルドリップ・ペーパードリップ","note":"カカオの余韻、深く穏やかな一杯。","description":"舞黒の定番となる深煎りブレンド。重厚なコクと穏やかな酸味に、カカオを思わせる余韻を重ねた味わいです。いつもの喫茶の一杯をご自宅でも。","ingredients":"コーヒー豆","badge":"店の定番","image":""}', 'synthetic'),
('BEAN-002', '舞黒 中煎りブレンド', 'beans', 1150, 8, '200 g', NULL, 1, '{"english":"HOUSE BLEND / MEDIUM","packLabel":"舞黒中煎り","packTone":"paper","origin":"ブラジル・グアテマラ","roast":"中煎り","process":"ナチュラル・ウォッシュト","acidity":2,"body":3,"sweet":null,"bitter":3,"aroma":4,"brew":"ペーパードリップ","note":"ナッツの香ばしさ、やわらかな口あたり。","description":"苦味と酸味のほどよい調和を大切にした中煎りブレンド。ナッツのような香ばしさと、やわらかな余韻を楽しむ毎日の珈琲です。","ingredients":"コーヒー豆","badge":"","image":""}', 'synthetic'),
('BEAN-003', 'エチオピア イルガチェフェ', 'beans', 1500, 8, '200 g', NULL, 2, '{"english":"ETHIOPIA / YIRGACHEFFE","packLabel":"イルガチェフェ","packTone":"rose","origin":"エチオピア・イルガチェフェ","roast":"浅煎り","process":"ウォッシュト","acidity":5,"body":2,"sweet":null,"bitter":1,"aroma":5,"brew":"ペーパードリップ","note":"花のような香り、柑橘の明るい余韻。","description":"花のような香りと柑橘を思わせる明るい酸味を楽しむ浅煎り。すっきりとした後味の一杯をお探しの方に。","ingredients":"コーヒー豆","badge":"香りを楽しむ","image":""}', 'synthetic'),
('BEAN-004', 'コロンビア ウイラ', 'beans', 1350, 8, '200 g', NULL, 3, '{"english":"COLOMBIA / HUILA","packLabel":"ウイラ","packTone":"paper","origin":"コロンビア・ウイラ","roast":"中煎り","process":"ウォッシュト","acidity":3,"body":3,"sweet":null,"bitter":3,"aroma":4,"brew":"ペーパードリップ・フレンチプレス","note":"赤い果実の印象、まろやかなコク。","description":"果実を思わせる香りと、まろやかなコクが重なる中煎り。軽やかさと飲みごたえの両方を楽しむ一杯です。","ingredients":"コーヒー豆","badge":"","image":""}', 'synthetic'),
('BEAN-005', 'インドネシア マンデリン', 'beans', 1450, 8, '200 g', NULL, 4, '{"english":"INDONESIA / MANDHELING","packLabel":"マンデリン","packTone":"ink","origin":"インドネシア・スマトラ島","roast":"深煎り","process":"スマトラ式","acidity":1,"body":5,"sweet":null,"bitter":5,"aroma":5,"brew":"ネルドリップ・フレンチプレス","note":"厚みのあるコク、静かに続く苦味。","description":"力強いコクと落ち着いた苦味を楽しむ深煎り。ゆっくりと味わう時間に合わせたい、重厚な飲みごたえです。","ingredients":"コーヒー豆","badge":"","image":""}', 'synthetic'),
('BEAN-006', 'グアテマラ アンティグア', 'beans', 1400, 8, '200 g', NULL, 5, '{"english":"GUATEMALA / ANTIGUA","packLabel":"アンティグア","packTone":"rose","origin":"グアテマラ・アンティグア","roast":"中深煎り","process":"ウォッシュト","acidity":2,"body":4,"sweet":null,"bitter":4,"aroma":4,"brew":"ペーパードリップ","note":"チョコレートのような香りと余韻。","description":"香ばしさの奥に、チョコレートを思わせる風味を感じる中深煎り。苦味とコクのバランスを楽しむ一杯です。","ingredients":"コーヒー豆","badge":"","image":""}', 'synthetic'),
('PRD-001', '舞黒 水出し珈琲', 'cold', 500, 8, '350 mL', 'SUP-02', 6, '{"english":"COLD BREW","vessel":"cold","tone":"tone-cool","sweet":1,"bitter":3,"aroma":4,"note":"すっきり、澄んだ余韻。","description":"ゆっくりと抽出した、軽やかな口あたりの水出し珈琲。珈琲そのものの香りを楽しみたい日に。","ingredients":"コーヒー","badge":"定番","image":""}', 'synthetic'),
('PRD-002', 'バニラクリーム水出し珈琲', 'cold', 600, 8, '350 mL', 'SUP-02', 7, '{"english":"VANILLA CREAM COLD BREW","vessel":"cream","tone":"tone-rose","sweet":4,"bitter":2,"aroma":5,"note":"ふわりと香る、やさしい甘さ。","description":"すっきりとした水出し珈琲に、バニラが香るクリームを重ねました。香りとまろやかさを、ひと口ずつ。","ingredients":"コーヒー、乳成分を含むクリーム、バニラシロップ","badge":"おすすめ","image":""}', 'synthetic'),
('PRD-003', '泡仕立て水出し珈琲', 'cold', 650, 8, '350 mL', 'SUP-04', 8, '{"english":"FOAM COLD BREW","vessel":"foam","tone":"","sweet":2,"bitter":3,"aroma":4,"note":"きめ細かな泡、なめらかな一杯。","description":"なめらかな泡と、水出し珈琲の落ち着いた香り。いつもの一杯とは少し違う口あたりを。","ingredients":"コーヒー、乳成分を含むフォーム","badge":"","image":""}', 'synthetic'),
('PRD-004', '深煎りエスプレッソ', 'coffee', 350, 8, '60 mL', 'SUP-03', 9, '{"english":"ESPRESSO","vessel":"hot","tone":"","sweet":1,"bitter":5,"aroma":5,"note":"短いひと息に、深い香り。","description":"深煎りの珈琲を、濃厚な一杯に。食後や仕事の合間に、ひと息つく時間を。","ingredients":"コーヒー","badge":"","image":""}', 'synthetic'),
('PRD-005', 'キャラメルマキアート', 'coffee', 550, 8, '300 mL', 'SUP-03', 10, '{"english":"CARAMEL MACCHIATO","vessel":"milk","tone":"tone-rose","sweet":5,"bitter":2,"aroma":4,"note":"ほろ苦い珈琲に、甘いごほうび。","description":"エスプレッソとミルクに、キャラメルの甘さを添えて。ゆっくり過ごしたい午後に。","ingredients":"コーヒー、牛乳、キャラメルソース","badge":"","image":""}', 'synthetic'),
('PRD-006', 'カプチーノ', 'coffee', 500, 8, '300 mL', 'SUP-03', 11, '{"english":"CAPPUCCINO","vessel":"hot","tone":"tone-cool","sweet":2,"bitter":3,"aroma":4,"note":"ミルクの泡と、珈琲の輪郭。","description":"エスプレッソの香りを、ふんわりとしたミルクの泡が包む一杯。","ingredients":"コーヒー、牛乳","badge":"","image":""}', 'synthetic'),
('PRD-007', '舞黒ブレンド珈琲', 'coffee', 400, 8, '300 mL', 'SUP-01', 12, '{"english":"MAIKURO HOUSE BLEND","vessel":"hot","tone":"","sweet":1,"bitter":3,"aroma":4,"note":"毎日にちょうどいい、わたしたちの味。","description":"香りと口あたりのバランスを大切にした、舞黒珈琲店の定番ブレンドです。","ingredients":"コーヒー","badge":"定番","image":""}', 'synthetic'),
('PRD-008', '本日のハンドドリップ珈琲', 'coffee', 550, 8, '300 mL', 'SUP-01', 13, '{"english":"HAND DRIP COFFEE","vessel":"hot","tone":"tone-cool","sweet":1,"bitter":2,"aroma":5,"note":"今日の香りを、一杯ずつ。","description":"その日の珈琲を、一杯ずつ丁寧に。豆の個性を楽しむハンドドリップです。","ingredients":"コーヒー","badge":"","image":""}', 'synthetic'),
('PRD-009', '和紅茶', 'tea', 400, 8, '300 mL', 'SUP-05', 14, '{"english":"JAPANESE BLACK TEA","vessel":"tea","tone":"tone-leaf","sweet":1,"bitter":1,"aroma":4,"note":"穏やかな香りで、気分を変えて。","description":"すっきりと飲みやすい和紅茶。珈琲とは少し違う、穏やかなひと息に。","ingredients":"紅茶","badge":"","image":""}', 'synthetic'),
('PRD-010', '抹茶ラテ', 'tea', 550, 8, '300 mL', 'SUP-05', 15, '{"english":"MATCHA LATTE","vessel":"matcha","tone":"tone-leaf","sweet":3,"bitter":2,"aroma":4,"note":"抹茶のほろ苦さ、ミルクのまろやかさ。","description":"抹茶の香りとやさしいミルクを合わせました。ひと口の余韻まで楽しめるラテです。","ingredients":"抹茶、牛乳、シロップ","badge":"","image":""}', 'synthetic'),
('PRD-011', 'あんバタークロワッサン', 'other', 350, 8, '1 個', 'SUP-01', 16, '{"english":"AN BUTTER CROISSANT","vessel":"pastry","tone":"","sweet":4,"bitter":null,"aroma":null,"note":"珈琲のおともに、もうひとつ。","description":"クロワッサンにあんとバターを合わせた、珈琲によく合うおやつです。","ingredients":"小麦、乳成分を含む生地、あん、バター","badge":"","image":""}', 'synthetic'),
('PRD-012', '舞黒珈琲店 ステンレスタンブラー', 'other', 2000, 10, '350 mL', 'SUP-01', 17, '{"english":"MAIKURO TUMBLER","vessel":"flask","tone":"tone-cool","sweet":null,"bitter":null,"aroma":null,"note":"いつもの一杯を、いつもの道へ。","description":"シンプルな舞黒珈琲店のタンブラー。日々の珈琲時間に寄り添う、350 mL のサイズです。","ingredients":"ステンレス","badge":"","image":""}', 'synthetic');

COMMIT;
