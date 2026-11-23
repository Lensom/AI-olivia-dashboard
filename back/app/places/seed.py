"""The starting list (from must-visit.json) and the ideas offered under "Maybe add to the list".

`wiki` is the English Wikipedia article whose picture the page shows; the summary API follows redirects."""

from __future__ import annotations

import re
from typing import Any

# (location, name, visited, wiki[, group])
_RAW: list[tuple[str, str, str, list[tuple[Any, ...]]]] = [
    ("culture", "🎨", "Культурні та мистецькі шедеври", [
        ("Париж, Франція", "Мона Ліза в Луврі", True, "Mona Lisa"),
        ("Ватикан", "Сикстинська капела та фрески Мікеланджело", False, "Sistine Chapel ceiling"),
        ("Амстердам, Нідерланди", "Картини Ван Гога в музеї Ван Гога", True, "Sunflowers (Van Gogh series)"),
        ("Мілан, Італія", "Таємна вечеря Леонардо да Вінчі", False, "The Last Supper (Leonardo)"),
        ("Флоренція, Італія", "Статуя Давида Мікеланджело (Галерея Академії) та Галерея Уффіці", False, "David (Michelangelo)"),
    ]),
    ("architecture", "🏛️", "Архітектурні дива та міські символи", [
        ("Париж, Франція", "Ейфелева вежа", True, "Eiffel Tower"),
        ("Нормандія, Франція", "Замок Ле-Мон-Сен-Мішель", True, "Mont-Saint-Michel"),
        ("Ватикан", "Собор Святого Петра", False, "St. Peter's Basilica"),
        ("Барселона, Іспанія", "Саграда Фамілія", True, "Sagrada Família"),
        ("Німеччина", "Замок Нойшванштайн", False, "Neuschwanstein Castle"),
        ("Берлін, Німеччина", "Берлінська стіна та Бранденбурзькі ворота", True, "Brandenburg Gate"),
        ("Лондон, Англія", "Біг Бен та Тауерський міст", False, "Tower Bridge"),
        ("Дубай, ОАЕ", "Бурдж-Халіфа", False, "Burj Khalifa"),
        ("США", "Статуя Свободи", False, "Statue of Liberty"),
        ("США", "Empire State Building", False, "Empire State Building"),
        ("США", "Міст «Золоті ворота»", False, "Golden Gate Bridge"),
        ("Сідней, Австралія", "Опера в Сіднеї", False, "Sydney Opera House"),
        ("Румунія", "Високогірна траса Трансфагараш", True, "Transfăgărășan"),
        ("Стамбул, Туреччина", "Собор Святої Софії (Ая-Софія)", True, "Hagia Sophia"),
        ("Стамбул, Туреччина", "Цистерна Базиліка", False, "Basilica Cistern"),
        ("Сінгапур", "Готель Marina Bay Sands та сади Gardens by the Bay", False, "Marina Bay Sands"),
    ]),
    ("ancient", "🗿", "Дива стародавнього світу та історія", [
        ("Єгипет", "Піраміди Гізи та Сфінкс", False, "Giza pyramid complex"),
        ("Єгипет", "Луксор та Долина царів", False, "Valley of the Kings"),
        ("Рим, Італія", "Колізей", True, "Colosseum"),
        ("Піза, Італія", "Пізанська вежа", False, "Leaning Tower of Pisa"),
        ("Італія", "Помпеї та вулкан Везувій", True, "Pompeii"),
        ("Китай", "Великий китайський мур", False, "Great Wall of China"),
        ("Китай", "Заборонене місто", False, "Forbidden City"),
        ("Перу", "Мачу-Пікчу", False, "Machu Picchu"),
        ("Йорданія", "Петра", False, "Petra"),
        ("Афіни, Греція", "Акрополь", False, "Acropolis of Athens"),
        ("Велика Британія", "Стоунхендж", False, "Stonehenge"),
        ("Камбоджа", "Ангкор-Ват", False, "Angkor Wat"),
        ("Індія", "Тадж-Махал", False, "Taj Mahal"),
        ("Мексика", "Чичен-Іца (піраміда майя Кукулькан)", False, "Chichen Itza"),
        ("Чилі", "Острів Великодня (кам'яні статуї Моаї)", False, "Moai"),
        ("Йорданія", "Пустеля Ваді-Рам (історичні пейзажі та марсіанські каньйони)", False, "Wadi Rum"),
    ]),
    ("nature", "🌍", "Природні дива та пейзажі", [
        ("США", "Гранд-Каньйон", False, "Grand Canyon"),
        ("США", "Національний парк Єллоустоун", False, "Yellowstone National Park"),
        ("США / Канада", "Ніагарський водоспад", False, "Niagara Falls"),
        ("Норвегія", "Фіорди", True, "Geirangerfjord"),
        ("Норвегія, Ісландія, Канада", "Північне сяйво", False, "Aurora"),
        ("Ісландія", "Гейзери, океан та кити", False, "Strokkur"),
        ("Аргентина / Бразилія", "Водоспад Ігуасу", False, "Iguazu Falls"),
        ("Аргентина", "Патагонія", False, "Patagonia"),
        ("Болівія", "Салар-де-Уюні (солончак)", False, "Salar de Uyuni"),
        ("Австралія", "Великий Бар'єрний риф", False, "Great Barrier Reef"),
        ("Ірландія", "Скелі Мохер", True, "Cliffs of Moher"),
        ("Франція", "Скелі Етрета", True, "Étretat"),
        ("Швейцарія", "Альпи", True, "Matterhorn"),
        ("Греція", "Метеори (скелі)", False, "Meteora"),
        ("Фарерські острови", "Дика природа", False, "Gásadalur"),
        ("Кенія", "Сафарі та дика природа", False, "Maasai Mara"),
        ("Японія", "Гора Фудзі", False, "Mount Fuji"),
        ("В'єтнам", "Бухта Халонг (тисячі вапнякових островів у смарагдовій воді)", False, "Ha Long Bay"),
        ("Зімбабве / Замбія", "Водоспад Вікторія", False, "Victoria Falls"),
        ("Норвегія", "Язик Троля (Trolltunga)", False, "Trolltunga"),
        ("Танзанія", "Сходження на Кіліманджаро", False, "Mount Kilimanjaro"),
    ]),
    ("cities", "🌆", "Атмосферні міста та локації (City Experience)", [
        ("Нью-Йорк, США", "Різдво, Таймс-сквер, Центральний парк", False, "Times Square"),
        ("Токіо, Японія", "Цвітіння сакури, перехрестя Сібуя, храми та техно-культура", False, "Shibuya Crossing"),
        ("Стамбул, Туреччина", "Міст між Європою та Азією", True, "Bosphorus Bridge"),
        ("Ріо-де-Жанейро, Бразилія", "Статуя Христа та Карнавал", False, "Christ the Redeemer (statue)"),
        ("Швейцарія", "Різдво, зима та Новий рік", False, "Zermatt"),
        ("Венеція, Італія", "Прогулянка на ґондолі каналами міста без авто", False, "Grand Canal (Venice)"),
        ("Лондон, Англія", "Атмосфера туманного міста, класичні паби, мюзикл у Вест-Енді", False, "West End theatre"),
        ("Сеул, Південна Корея", "Прадавні палаци, K-Culture та технології майбутнього", False, "Gyeongbokgung"),
        ("Лапландія, Фінляндія", "Резиденція Санта-Клауса (Рованіємі) та ніч у скляному іглу під північним сяйвом", False, "Santa Claus Village"),
    ]),
    ("events", "🎢", "Розваги, фестивалі та івенти", [
        ("Париж, Франція", "Діснейленд", True, "Disneyland Paris", "Парки розваг"),
        ("Орландо, США", "Universal Park", False, "Universal Orlando", "Парки розваг"),
        ("Лондон, Англія", "Warner Bros. Studio", False, "Warner Bros. Studio Tour London", "Парки розваг"),
        ("Пустеля Блек-Рок, США", "Burning Man", False, "Burning Man", "Фестивалі"),
        ("США", "Coachella", False, "Coachella", "Фестивалі"),
        ("Бом, Бельгія", "Tomorrowland", False, "Tomorrowland (festival)", "Фестивалі"),
        ("Мюнхен, Німеччина", "Октоберфест", False, "Oktoberfest", "Фестивалі"),
        ("Каппадокія, Туреччина", "Фестиваль повітряних куль", False, "Cappadocia", "Фестивалі"),
        ("Барселона, Іспанія", "Матч на стадіоні Camp Nou", False, "Camp Nou", "Спорт та шоу"),
        ("Прага, Чехія", "Концерт Imagine Dragons", True, "Imagine Dragons", "Спорт та шоу"),
        ("", "Формула-1: гран-прі наживо", False, "Formula One", "Спорт та шоу"),
        ("США", "Матч NBA або Super Bowl", False, "Super Bowl", "Спорт та шоу"),
    ]),
]

# Ideas to offer: (category, location, name, wiki). Shown until added or dismissed.
SUGGESTIONS: list[tuple[str, str, str, str]] = [
    ("architecture", "Гранада, Іспанія", "Альгамбра", "Alhambra"),
    ("architecture", "Прага, Чехія", "Старе місто та Карлів міст", "Charles Bridge"),
    ("architecture", "Дубровник, Хорватія", "Стіни старого міста", "Walls of Dubrovnik"),
    ("ancient", "Туреччина", "Памуккале та Ієраполь", "Pamukkale"),
    ("ancient", "Шрі-Ланка", "Скеля Сігірія", "Sigiriya"),
    ("nature", "Хорватія", "Плітвицькі озера", "Plitvice Lakes National Park"),
    ("nature", "Норвегія", "Лофотенські острови", "Lofoten"),
    ("nature", "Словенія", "Озеро Блед", "Lake Bled"),
    ("nature", "Канада", "Національний парк Банф та озеро Морейн", "Moraine Lake"),
    ("nature", "США", "Каньйон Антилопи", "Antelope Canyon"),
    ("nature", "Еквадор", "Галапагоські острови", "Galápagos Islands"),
    ("nature", "Марокко", "Ніч у пустелі Сахара (Мерзуга)", "Erg Chebbi"),
    ("cities", "Санторіні, Греція", "Захід сонця в Ії", "Oia, Greece"),
    ("cities", "Італія", "Чинкве-Терре", "Cinque Terre"),
    ("cities", "Австрія", "Гальштат", "Hallstatt"),
    ("cities", "Кіото, Японія", "Тисячі воріт торії Фусімі Інарі", "Fushimi Inari-taisha"),
    ("cities", "Гонконг", "Панорама з піку Вікторія", "Victoria Peak"),
    ("events", "Венеція, Італія", "Венеціанський карнавал", "Carnival of Venice"),
    ("events", "Монако", "Гран-прі Монако", "Port Hercules"),
    ("events", "Единбург, Шотландія", "Fringe-фестиваль", "Edinburgh Festival Fringe"),
    ("events", "Чіангмай, Таїланд", "Фестиваль небесних ліхтарів Йі Пенг", "Yi Peng"),
]


def slug(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-").lower()[:40] or "place"


def suggestion_id(wiki: str) -> str:
    return "s-" + slug(wiki)[:38]


def starting_list() -> dict[str, Any]:
    categories = []
    for cat_id, emoji, title, rows in _RAW:
        items = []
        for row in rows:
            location, name, visited, wiki = row[:4]
            items.append({
                "id": slug(wiki),
                "name": name,
                "location": location,
                "group": row[4] if len(row) > 4 else "",
                "visited": visited,
                "wiki": wiki,
                "image": "",
                "note": "",
            })
        categories.append({"id": cat_id, "emoji": emoji, "title": title, "items": items})
    return {"categories": categories, "dismissed": []}
