/**
 * JEOPARDY CHALLENGE — the fixed solo boards.
 *
 * The content lives in the repo, not the database, on purpose: every player
 * everywhere must see the exact same nine clues so the leaderboard means
 * something, the set never changes once people have posted scores, and a
 * deploy is the only "migration" content ever needs. Only RESULTS go to
 * Supabase.
 *
 * Two collections:
 *   · The Lineup — eight boards: Kids, Teen, College, and five standard.
 *   · Michael's Jeopardy Challenge — ten boards, all geography.
 *
 * Every board is 3 categories × 3 clues at $200/$400/$600, so a perfect game
 * is $3,600. Clues are written in Jeopardy voice (statements), answers kept
 * to distinctive words the string checker in answer-check.ts handles well.
 */

export type ChallengeTier = 'kids' | 'teen' | 'college' | 'standard' | 'geography'

export interface ChallengeClue {
  question: string
  answer: string
}

export interface ChallengeCategory {
  name: string
  /** Exactly three, in $200 / $400 / $600 order. */
  clues: ChallengeClue[]
}

export interface ChallengeGame {
  /** Stable slug — leaderboard rows key on this, so it must never change. */
  key: string
  title: string
  tier: ChallengeTier
  series: 'lineup' | 'michaels'
  blurb: string
  /** Exactly three. */
  categories: ChallengeCategory[]
}

export const CHALLENGE_CLUE_VALUES = [200, 400, 600]

/** A perfect board: every clue right. */
export const CHALLENGE_MAX_SCORE =
  CHALLENGE_CLUE_VALUES.reduce((a, b) => a + b, 0) * 3

export const TIER_LABELS: Record<ChallengeTier, string> = {
  kids: 'Kids',
  teen: 'Teen',
  college: 'College',
  standard: 'Standard',
  geography: 'Geography',
}

export const CHALLENGE_GAMES: ChallengeGame[] = [
  // ───────────────────────────── THE LINEUP ─────────────────────────────
  {
    key: 'kids-challenge',
    title: "Kids' Challenge",
    tier: 'kids',
    series: 'lineup',
    blurb: 'Animals, storybooks and outer space — the friendly one.',
    categories: [
      {
        name: 'Animal Kingdom',
        clues: [
          { question: 'This black-and-white bear from China loves to munch on bamboo', answer: 'panda' },
          { question: 'The tallest animal on Earth, it can reach leaves 18 feet up without a ladder', answer: 'giraffe' },
          { question: 'This eight-armed sea creature can squirt ink and squeeze through tiny cracks', answer: 'octopus' },
        ],
      },
      {
        name: 'Once Upon a Time',
        clues: [
          { question: 'She left a glass slipper behind at the ball', answer: 'Cinderella' },
          { question: 'This wooden puppet’s nose grew every time he told a lie', answer: 'Pinocchio' },
          { question: 'In "Charlotte’s Web", Charlotte is this kind of creature', answer: 'spider' },
        ],
      },
      {
        name: 'Out in Space',
        clues: [
          { question: 'The star at the center of our solar system — don’t stare at it', answer: 'the sun' },
          { question: 'This red planet is named for the Roman god of war', answer: 'Mars' },
          { question: 'Neil Armstrong was the first person to walk on this', answer: 'the moon' },
        ],
      },
    ],
  },
  {
    key: 'teen-challenge',
    title: 'Teen Challenge',
    tier: 'teen',
    series: 'lineup',
    blurb: 'Movies, gaming and music — bring your group chat energy.',
    categories: [
      {
        name: 'The Big Screen',
        clues: [
          { question: 'Miles Morales swings through Brooklyn as this masked Marvel hero', answer: 'Spider-Man' },
          { question: 'In this 2023 movie, Margot Robbie leaves a pink dreamhouse for the real world', answer: 'Barbie' },
          { question: 'This director of "Jaws" and "E.T." also brought dinosaurs back in "Jurassic Park"', answer: 'Steven Spielberg' },
        ],
      },
      {
        name: 'Game On',
        clues: [
          { question: 'Creepers, Endermen and diamond pickaxes belong to this blocky world', answer: 'Minecraft' },
          { question: 'This Nintendo plumber has been jumping on Goombas since 1985', answer: 'Mario' },
          { question: 'The battle-royale game where a hundred players drop onto an island and the storm closes in', answer: 'Fortnite' },
        ],
      },
      {
        name: 'Chart Toppers',
        clues: [
          { question: 'Swifties packed stadiums worldwide for this record-smashing Taylor Swift tour', answer: 'the Eras Tour' },
          { question: '"Blinding Lights" and "Starboy" are hits from this Canadian artist with a day of the week in his name', answer: 'the Weeknd' },
          { question: 'This K-pop supergroup’s army of fans is literally called ARMY', answer: 'BTS' },
        ],
      },
    ],
  },
  {
    key: 'college-challenge',
    title: 'College Challenge',
    tier: 'college',
    series: 'lineup',
    blurb: 'Philosophy, lab science and the reading list — office hours won’t save you.',
    categories: [
      {
        name: 'Philosophy 101',
        clues: [
          { question: '"I think, therefore I am" is the famous conclusion of this French philosopher', answer: 'Descartes' },
          { question: 'This Greek philosopher was sentenced to drink hemlock for corrupting the youth of Athens', answer: 'Socrates' },
          { question: 'His "Critique of Pure Reason" asked what the mind itself brings to experience', answer: 'Kant' },
        ],
      },
      {
        name: 'Lab Section',
        clues: [
          { question: 'H2SO4 is the formula for this strong acid', answer: 'sulfuric acid' },
          { question: 'This organelle, the cell’s power plant, turns glucose into ATP', answer: 'mitochondria' },
          { question: 'The constant 6.022 × 10²³, the number of particles in a mole, is named for him', answer: 'Avogadro' },
        ],
      },
      {
        name: 'Required Reading',
        clues: [
          { question: 'Jay Gatsby throws his doomed parties in this Fitzgerald novel', answer: 'The Great Gatsby' },
          { question: '"It was the best of times, it was the worst of times" opens this Dickens novel', answer: 'A Tale of Two Cities' },
          { question: 'This Colombian author’s "One Hundred Years of Solitude" follows the Buendía family', answer: 'Gabriel Garcia Marquez' },
        ],
      },
    ],
  },
  {
    key: 'standard-1',
    title: 'Challenge No. 1',
    tier: 'standard',
    series: 'lineup',
    blurb: 'Presidents, word origins and the human body.',
    categories: [
      {
        name: 'American Presidents',
        clues: [
          { question: 'This president appears on the penny and delivered the Gettysburg Address', answer: 'Lincoln' },
          { question: 'The only president to serve more than two terms, he led the U.S. through most of World War II', answer: 'Franklin Roosevelt' },
          { question: 'This president bought the Louisiana Territory from France in 1803', answer: 'Jefferson' },
        ],
      },
      {
        name: 'Word Origins',
        clues: [
          { question: 'From the Greek for "circle of animals", it’s the band of constellations your horoscope lives in', answer: 'zodiac' },
          { question: 'This word for a sudden overthrow of a government comes from the French for "blow of state"', answer: 'coup' },
          { question: 'From Latin for "little mouse", it’s the tissue that moves your bones', answer: 'muscle' },
        ],
      },
      {
        name: 'The Human Body',
        clues: [
          { question: 'The largest organ of the human body, it’s the one you can see', answer: 'skin' },
          { question: 'These two bean-shaped organs filter your blood and make urine', answer: 'kidneys' },
          { question: 'The femur is the longest bone in the body; it’s found in this limb segment', answer: 'thigh' },
        ],
      },
    ],
  },
  {
    key: 'standard-2',
    title: 'Challenge No. 2',
    tier: 'standard',
    series: 'lineup',
    blurb: 'World history, food science and famous firsts.',
    categories: [
      {
        name: 'World History',
        clues: [
          { question: 'This wall dividing a German city fell in 1989', answer: 'the Berlin Wall' },
          { question: 'In 1215 English barons forced King John to seal this "great charter"', answer: 'Magna Carta' },
          { question: 'This Carthaginian general marched elephants over the Alps to attack Rome', answer: 'Hannibal' },
        ],
      },
      {
        name: 'Kitchen Chemistry',
        clues: [
          { question: 'This fungus makes bread rise by burping out carbon dioxide', answer: 'yeast' },
          { question: 'Browning meat at high heat gets its flavor from this reaction named for a French chemist', answer: 'Maillard reaction' },
          { question: 'Egg whites whipped with sugar and baked slowly become this crisp French confection', answer: 'meringue' },
        ],
      },
      {
        name: 'Famous Firsts',
        clues: [
          { question: 'In 1961 this Soviet cosmonaut became the first human in space', answer: 'Yuri Gagarin' },
          { question: 'In 1903 these two brothers made the first powered airplane flight at Kitty Hawk', answer: 'the Wright brothers' },
          { question: 'In 1928 Alexander Fleming noticed a mold killing bacteria and discovered this first antibiotic', answer: 'penicillin' },
        ],
      },
    ],
  },
  {
    key: 'standard-3',
    title: 'Challenge No. 3',
    tier: 'standard',
    series: 'lineup',
    blurb: 'Shakespeare, numbers and great inventions.',
    categories: [
      {
        name: 'Shakespeare & Co.',
        clues: [
          { question: 'This tragedy’s star-crossed lovers hail from feuding Verona households', answer: 'Romeo and Juliet' },
          { question: 'This Danish prince ponders "to be, or not to be"', answer: 'Hamlet' },
          { question: 'Witches promise this Scottish general he’ll be king — it goes badly', answer: 'Macbeth' },
        ],
      },
      {
        name: 'By the Numbers',
        clues: [
          { question: 'The ratio of a circle’s circumference to its diameter, roughly 3.14159', answer: 'pi' },
          { question: 'A number divisible only by 1 and itself, like 7 or 13, gets this name', answer: 'prime' },
          { question: '1, 1, 2, 3, 5, 8, 13 — each number the sum of the two before it, named for this Italian', answer: 'Fibonacci' },
        ],
      },
      {
        name: 'Great Inventions',
        clues: [
          { question: 'Johannes Gutenberg’s 15th-century machine put one of these in every scriptorium out of business', answer: 'printing press' },
          { question: 'Alexander Graham Bell’s first words on this 1876 invention were "Mr. Watson, come here"', answer: 'telephone' },
          { question: 'This Serbian-American inventor championed alternating current and lends his name to an EV maker', answer: 'Tesla' },
        ],
      },
    ],
  },
  {
    key: 'standard-4',
    title: 'Challenge No. 4',
    tier: 'standard',
    series: 'lineup',
    blurb: 'Ancient worlds, art and sports legends.',
    categories: [
      {
        name: 'Ancient Worlds',
        clues: [
          { question: 'The Great Pyramid of Giza was built as a tomb for this kind of Egyptian ruler', answer: 'pharaoh' },
          { question: 'Gladiators fought in this great Roman amphitheater, still standing today', answer: 'the Colosseum' },
          { question: 'This Greek city-state raised its boys from age seven to be soldiers', answer: 'Sparta' },
        ],
      },
      {
        name: 'Art & Artists',
        clues: [
          { question: 'Leonardo da Vinci painted this portrait with the world’s most famous smile', answer: 'Mona Lisa' },
          { question: 'This Dutch post-impressionist painted "The Starry Night" and sunflowers, and sold almost nothing in his lifetime', answer: 'van Gogh' },
          { question: 'This Spaniard co-founded Cubism and painted the antiwar mural "Guernica"', answer: 'Picasso' },
        ],
      },
      {
        name: 'Sports Legends',
        clues: [
          { question: 'This Chicago Bull won six NBA titles and starred in "Space Jam"', answer: 'Michael Jordan' },
          { question: 'Nicknamed "The Greatest", he won boxing gold in Rome in 1960 and lit the torch in Atlanta in 1996', answer: 'Muhammad Ali' },
          { question: 'This Jamaican sprinter holds the 100-meter world record at 9.58 seconds', answer: 'Usain Bolt' },
        ],
      },
    ],
  },
  {
    key: 'standard-5',
    title: 'Challenge No. 5',
    tier: 'standard',
    series: 'lineup',
    blurb: 'Space, classical music and mythology.',
    categories: [
      {
        name: 'The Cosmos',
        clues: [
          { question: 'This planet’s spectacular rings are made mostly of ice', answer: 'Saturn' },
          { question: 'A star that collapses so far not even light escapes becomes this', answer: 'black hole' },
          { question: 'This space telescope, launched in 2021, sees the early universe in infrared', answer: 'James Webb' },
        ],
      },
      {
        name: 'Classical Notes',
        clues: [
          { question: 'This composer kept writing symphonies after losing his hearing, including the Ninth', answer: 'Beethoven' },
          { question: 'This child prodigy from Salzburg wrote "The Magic Flute" and over 600 works before dying at 35', answer: 'Mozart' },
          { question: 'The "Four Seasons" violin concertos are by this Venetian priest', answer: 'Vivaldi' },
        ],
      },
      {
        name: 'Myth & Legend',
        clues: [
          { question: 'King of the Greek gods, he threw thunderbolts from Mount Olympus', answer: 'Zeus' },
          { question: 'This hero’s only weak spot was his heel', answer: 'Achilles' },
          { question: 'In Norse myth, this one-eyed Allfather traded an eye for wisdom', answer: 'Odin' },
        ],
      },
    ],
  },

  // ─────────────────── MICHAEL'S JEOPARDY CHALLENGE ───────────────────
  {
    key: 'michaels-1',
    title: 'World Capitals',
    tier: 'geography',
    series: 'michaels',
    blurb: 'Game 1 of 10 — capitals on three continents.',
    categories: [
      {
        name: 'European Capitals',
        clues: [
          { question: 'The Eiffel Tower rises over this capital on the Seine', answer: 'Paris' },
          { question: 'This Spanish capital sits almost exactly in the center of the country', answer: 'Madrid' },
          { question: 'Buda and Pest, on opposite banks of the Danube, merged into this capital', answer: 'Budapest' },
        ],
      },
      {
        name: 'Capitals of Asia',
        clues: [
          { question: 'The world’s most populous metro area, it’s Japan’s capital', answer: 'Tokyo' },
          { question: 'This South Korean capital sits just 35 miles from the DMZ', answer: 'Seoul' },
          { question: 'Once called Rangoon’s rival, this purpose-built city replaced Rangoon as Myanmar’s capital in 2006', answer: 'Naypyidaw' },
        ],
      },
      {
        name: 'Capital Curveballs',
        clues: [
          { question: 'Australia’s capital is not Sydney or Melbourne but this planned city', answer: 'Canberra' },
          { question: 'Brazil’s modernist capital, carved out of the interior in 1960', answer: 'Brasilia' },
          { question: 'This African country has three capitals: Pretoria, Cape Town and Bloemfontein', answer: 'South Africa' },
        ],
      },
    ],
  },
  {
    key: 'michaels-2',
    title: 'Rivers of the World',
    tier: 'geography',
    series: 'michaels',
    blurb: 'Game 2 of 10 — follow the water.',
    categories: [
      {
        name: 'Big Rivers',
        clues: [
          { question: 'This river carries more water than the next seven largest combined, draining a South American rainforest', answer: 'Amazon' },
          { question: 'The longest river in the United States, it joins the Mississippi at St. Louis', answer: 'Missouri' },
          { question: 'This river’s annual floods fed Egypt for five thousand years', answer: 'the Nile' },
        ],
      },
      {
        name: 'River Cities',
        clues: [
          { question: 'London straddles this river', answer: 'the Thames' },
          { question: 'Vienna, Budapest and Belgrade all sit on this river', answer: 'the Danube' },
          { question: 'Cairo sits on this river’s east bank', answer: 'the Nile' },
        ],
      },
      {
        name: 'Wild Waters',
        clues: [
          { question: 'Victoria Falls thunders on this African river between Zambia and Zimbabwe', answer: 'Zambezi' },
          { question: 'This Asian river, the "Mother of Waters", runs from Tibet through six countries to Vietnam’s delta', answer: 'Mekong' },
          { question: 'The Grand Canyon was carved by this river', answer: 'Colorado' },
        ],
      },
    ],
  },
  {
    key: 'michaels-3',
    title: 'Mountains & Peaks',
    tier: 'geography',
    series: 'michaels',
    blurb: 'Game 3 of 10 — thin air up here.',
    categories: [
      {
        name: 'Famous Peaks',
        clues: [
          { question: 'At 29,032 feet, it’s the world’s highest mountain', answer: 'Everest' },
          { question: 'Africa’s tallest mountain, a snow-capped volcano in Tanzania', answer: 'Kilimanjaro' },
          { question: 'This Japanese volcano’s perfect cone appears in countless woodblock prints', answer: 'Mount Fuji' },
        ],
      },
      {
        name: 'The Ranges',
        clues: [
          { question: 'This range forms the spine of western South America', answer: 'the Andes' },
          { question: 'Europe’s Mont Blanc and the Matterhorn belong to this range', answer: 'the Alps' },
          { question: 'This range separates Europe from Asia in Russia', answer: 'the Urals' },
        ],
      },
      {
        name: 'High Places',
        clues: [
          { question: 'This Andean citadel of the Inca sits at 8,000 feet above a Peruvian river valley', answer: 'Machu Picchu' },
          { question: 'La Paz, the world’s highest capital city, sits in this country', answer: 'Bolivia' },
          { question: 'The highest peak in North America, in Alaska, reclaimed this native name in 2015', answer: 'Denali' },
        ],
      },
    ],
  },
  {
    key: 'michaels-4',
    title: 'Islands',
    tier: 'geography',
    series: 'michaels',
    blurb: 'Game 4 of 10 — surrounded by water on all sides.',
    categories: [
      {
        name: 'Big Islands',
        clues: [
          { question: 'The world’s largest island, mostly covered by an ice sheet', answer: 'Greenland' },
          { question: 'This island nation off southeast Africa is home to lemurs found nowhere else', answer: 'Madagascar' },
          { question: 'Borneo is shared by Malaysia, Brunei and this country', answer: 'Indonesia' },
        ],
      },
      {
        name: 'Island Nations',
        clues: [
          { question: 'This Caribbean island nation, the largest in the region, has Havana as its capital', answer: 'Cuba' },
          { question: 'Reykjavik is the capital of this land of glaciers and volcanoes', answer: 'Iceland' },
          { question: 'This Pacific archipelago of over 7,000 islands has Manila as its capital', answer: 'the Philippines' },
        ],
      },
      {
        name: 'Island Hopping',
        clues: [
          { question: 'Darwin studied finches on these Ecuadorian islands', answer: 'the Galapagos' },
          { question: 'This Italian island, the largest in the Mediterranean, sits at the toe of the boot', answer: 'Sicily' },
          { question: 'Oahu, Maui and the Big Island belong to this U.S. state', answer: 'Hawaii' },
        ],
      },
    ],
  },
  {
    key: 'michaels-5',
    title: 'The 50 States',
    tier: 'geography',
    series: 'michaels',
    blurb: 'Game 5 of 10 — America, coast to coast.',
    categories: [
      {
        name: 'State Capitals',
        clues: [
          { question: 'The capital of Texas, it keeps itself weird', answer: 'Austin' },
          { question: 'New York’s capital is not NYC but this upstate city on the Hudson', answer: 'Albany' },
          { question: 'This western state capital is the only one named for a president', answer: 'Lincoln' },
        ],
      },
      {
        name: 'State Superlatives',
        clues: [
          { question: 'The largest state by area — more than twice the size of Texas', answer: 'Alaska' },
          { question: 'The smallest state, with the longest official name', answer: 'Rhode Island' },
          { question: 'Death Valley, the lowest and hottest place in North America, is in this state', answer: 'California' },
        ],
      },
      {
        name: 'Borders & Shapes',
        clues: [
          { question: 'This state is shaped like a mitten, with a second peninsula up north', answer: 'Michigan' },
          { question: 'Four Corners is the only spot where four states meet: Arizona, Utah, Colorado and this one', answer: 'New Mexico' },
          { question: 'This state touches only one other state — New Hampshire', answer: 'Maine' },
        ],
      },
    ],
  },
  {
    key: 'michaels-6',
    title: 'South America',
    tier: 'geography',
    series: 'michaels',
    blurb: 'Game 6 of 10 — Cartagena to Buenos Aires, the long way.',
    categories: [
      {
        name: 'Countries & Capitals',
        clues: [
          { question: 'Tango was born in this Argentine capital on the Río de la Plata', answer: 'Buenos Aires' },
          { question: 'This country’s capital, Bogotá, sits high in the Andes; Cartagena is its Caribbean jewel', answer: 'Colombia' },
          { question: 'The only South American country where Dutch is the official language', answer: 'Suriname' },
        ],
      },
      {
        name: 'Landscapes',
        clues: [
          { question: 'This driest desert on Earth runs down Chile’s northern coast', answer: 'Atacama' },
          { question: 'These vast grasslands of Argentina are home of the gaucho', answer: 'the Pampas' },
          { question: 'This Bolivian salt flat, the world’s largest, becomes a giant mirror after rain', answer: 'Salar de Uyuni' },
        ],
      },
      {
        name: 'The Long Road South',
        clues: [
          { question: 'Machu Picchu draws travelers to this country', answer: 'Peru' },
          { question: 'This waterfall system on the Argentina–Brazil border dwarfs Niagara', answer: 'Iguazu Falls' },
          { question: 'The southern tip of the continent, shared by Chile and Argentina, is named for "land of fire"', answer: 'Tierra del Fuego' },
        ],
      },
    ],
  },
  {
    key: 'michaels-7',
    title: 'Africa',
    tier: 'geography',
    series: 'michaels',
    blurb: 'Game 7 of 10 — fifty-four countries, one board.',
    categories: [
      {
        name: 'Countries',
        clues: [
          { question: 'The most populous country in Africa, home to Lagos and Nollywood', answer: 'Nigeria' },
          { question: 'This country at Africa’s northeast corner is crossed by both the Nile and the Suez Canal', answer: 'Egypt' },
          { question: 'Formerly Abyssinia, this country was never colonized and has Addis Ababa as its capital', answer: 'Ethiopia' },
        ],
      },
      {
        name: 'Natural Africa',
        clues: [
          { question: 'The world’s largest hot desert, stretching across the continent’s north', answer: 'the Sahara' },
          { question: 'Wildebeest migrate in their millions across this Tanzanian plain', answer: 'Serengeti' },
          { question: 'The deepest African Great Lake, second-deepest in the world, bordered by four countries', answer: 'Lake Tanganyika' },
        ],
      },
      {
        name: 'Cities of Africa',
        clues: [
          { question: 'Table Mountain looms over this South African city', answer: 'Cape Town' },
          { question: 'This Moroccan city shares its name with a classic Bogart film', answer: 'Casablanca' },
          { question: 'Kenya’s capital, whose name comes from a Maasai phrase for "cool waters"', answer: 'Nairobi' },
        ],
      },
    ],
  },
  {
    key: 'michaels-8',
    title: 'Asia',
    tier: 'geography',
    series: 'michaels',
    blurb: 'Game 8 of 10 — the biggest continent gets a board.',
    categories: [
      {
        name: 'Countries',
        clues: [
          { question: 'This country of a billion-plus people is shaped like a diamond, with the Ganges across its north', answer: 'India' },
          { question: 'The only country bordering both Thailand and Vietnam on the Mekong, once called the Khmer Empire', answer: 'Cambodia' },
          { question: 'This doubly landlocked Central Asian country’s cities include Samarkand and Tashkent', answer: 'Uzbekistan' },
        ],
      },
      {
        name: 'Asian Cities',
        clues: [
          { question: 'The Burj Khalifa, the world’s tallest building, rises over this Gulf city', answer: 'Dubai' },
          { question: 'This city-state at the tip of the Malay Peninsula is both a city and a country', answer: 'Singapore' },
          { question: 'Once Constantinople, this Turkish city straddles two continents', answer: 'Istanbul' },
        ],
      },
      {
        name: 'Natural Asia',
        clues: [
          { question: 'This high plateau north of the Himalayas is called the Roof of the World', answer: 'Tibet' },
          { question: 'The world’s deepest lake, in Siberia, holds a fifth of Earth’s fresh water', answer: 'Lake Baikal' },
          { question: 'This shrinking salt sea between Kazakhstan and Uzbekistan was once the world’s fourth-largest lake', answer: 'Aral Sea' },
        ],
      },
    ],
  },
  {
    key: 'michaels-9',
    title: 'Europe',
    tier: 'geography',
    series: 'michaels',
    blurb: 'Game 9 of 10 — small continent, dense board.',
    categories: [
      {
        name: 'Countries',
        clues: [
          { question: 'This boot-shaped country kicks the island of Sicily', answer: 'Italy' },
          { question: 'Europe’s largest country lying entirely within the continent, its capital is Kyiv', answer: 'Ukraine' },
          { question: 'This microstate in the Pyrenees sits between France and Spain', answer: 'Andorra' },
        ],
      },
      {
        name: 'European Cities',
        clues: [
          { question: 'Gondolas glide down the Grand Canal in this Italian city', answer: 'Venice' },
          { question: 'This Czech capital’s astronomical clock has run since 1410', answer: 'Prague' },
          { question: 'Gaudí’s unfinished Sagrada Família rises over this Catalan city', answer: 'Barcelona' },
        ],
      },
      {
        name: 'Natural Europe',
        clues: [
          { question: 'These deep glacial inlets slice Norway’s coastline', answer: 'fjords' },
          { question: 'This active volcano towers over the Sicilian city of Catania', answer: 'Etna' },
          { question: 'The Iberian Peninsula is separated from Africa by this strait', answer: 'Gibraltar' },
        ],
      },
    ],
  },
  {
    key: 'michaels-10',
    title: 'Landmarks & Wonders',
    tier: 'geography',
    series: 'michaels',
    blurb: 'Game 10 of 10 — the finale: the places on the postcards.',
    categories: [
      {
        name: 'Monuments',
        clues: [
          { question: 'This copper lady has lifted her torch over New York Harbor since 1886', answer: 'Statue of Liberty' },
          { question: 'This white marble mausoleum in Agra was built by an emperor for his late wife', answer: 'Taj Mahal' },
          { question: 'Christ the Redeemer spreads his arms over this Brazilian city', answer: 'Rio de Janeiro' },
        ],
      },
      {
        name: 'Wonders of the World',
        clues: [
          { question: 'The only ancient wonder still standing, on the Giza plateau', answer: 'the Great Pyramid' },
          { question: 'This fortification, thousands of miles long, is China’s most famous construction project', answer: 'the Great Wall' },
          { question: 'This rose-red city carved into Jordanian cliffs starred in an Indiana Jones finale', answer: 'Petra' },
        ],
      },
      {
        name: 'Where in the World',
        clues: [
          { question: 'The Golden Gate Bridge spans the entrance to this city’s bay', answer: 'San Francisco' },
          { question: 'This opera house’s white sails billow over an Australian harbor', answer: 'Sydney Opera House' },
          { question: 'Moai statues stare inland on this remote Chilean island', answer: 'Easter Island' },
        ],
      },
    ],
  },
]

export function getChallengeGame(key: string): ChallengeGame | undefined {
  return CHALLENGE_GAMES.find((g) => g.key === key)
}

export const LINEUP_GAMES = CHALLENGE_GAMES.filter((g) => g.series === 'lineup')
export const MICHAELS_GAMES = CHALLENGE_GAMES.filter((g) => g.series === 'michaels')
