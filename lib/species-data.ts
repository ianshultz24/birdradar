export interface SpeciesEntry {
  speciesCode: string;
  comName: string;
  sciName: string;
}

export const PNW_SPECIES: SpeciesEntry[] = [
  // Loons
  { speciesCode: 'comloo', comName: 'Common Loon', sciName: 'Gavia immer' },
  { speciesCode: 'pacloo', comName: 'Pacific Loon', sciName: 'Gavia pacifica' },
  { speciesCode: 'redtlo', comName: 'Red-throated Loon', sciName: 'Gavia stellata' },
  // Grebes
  { speciesCode: 'piebgr', comName: 'Pied-billed Grebe', sciName: 'Podilymbus podiceps' },
  { speciesCode: 'horgre', comName: 'Horned Grebe', sciName: 'Podiceps auritus' },
  { speciesCode: 'redneg', comName: 'Red-necked Grebe', sciName: 'Podiceps grisegena' },
  { speciesCode: 'wesgre', comName: 'Western Grebe', sciName: 'Aechmophorus occidentalis' },
  { speciesCode: 'clagre', comName: "Clark's Grebe", sciName: 'Aechmophorus clarkii' },
  // Pelicans & Cormorants
  { speciesCode: 'amwpel', comName: 'American White Pelican', sciName: 'Pelecanus erythrorhynchos' },
  { speciesCode: 'browpe', comName: 'Brown Pelican', sciName: 'Pelecanus occidentalis' },
  { speciesCode: 'doccor', comName: 'Double-crested Cormorant', sciName: 'Nannopterum auritum' },
  { speciesCode: 'brnboo', comName: "Brandt's Cormorant", sciName: 'Urile penicillatus' },
  { speciesCode: 'pelcor', comName: 'Pelagic Cormorant', sciName: 'Urile pelagicus' },
  // Herons & Egrets
  { speciesCode: 'grbher3', comName: 'Great Blue Heron', sciName: 'Ardea herodias' },
  { speciesCode: 'greegr', comName: 'Great Egret', sciName: 'Ardea alba' },
  { speciesCode: 'snoegr', comName: 'Snowy Egret', sciName: 'Egretta thula' },
  { speciesCode: 'greher4', comName: 'Green Heron', sciName: 'Butorides virescens' },
  { speciesCode: 'bkcher', comName: 'Black-crowned Night-Heron', sciName: 'Nycticorax nycticorax' },
  // Waterfowl – Geese & Swans
  { speciesCode: 'cangoo', comName: 'Canada Goose', sciName: 'Branta canadensis' },
  { speciesCode: 'cacgoo', comName: 'Cackling Goose', sciName: 'Branta hutchinsii' },
  { speciesCode: 'snogoo', comName: 'Snow Goose', sciName: 'Anser caerulescens' },
  { speciesCode: 'gwfgoo', comName: 'Greater White-fronted Goose', sciName: 'Anser albifrons' },
  { speciesCode: 'tunswa', comName: 'Tundra Swan', sciName: 'Cygnus columbianus' },
  { speciesCode: 'truswa', comName: 'Trumpeter Swan', sciName: 'Cygnus buccinator' },
  // Ducks
  { speciesCode: 'wooduc', comName: 'Wood Duck', sciName: 'Aix sponsa' },
  { speciesCode: 'amewid', comName: 'American Wigeon', sciName: 'Mareca americana' },
  { speciesCode: 'eurwig', comName: 'Eurasian Wigeon', sciName: 'Mareca penelope' },
  { speciesCode: 'mallar3', comName: 'Mallard', sciName: 'Anas platyrhynchos' },
  { speciesCode: 'norpin', comName: 'Northern Pintail', sciName: 'Anas acuta' },
  { speciesCode: 'gnwtea1', comName: 'Green-winged Teal', sciName: 'Anas crecca' },
  { speciesCode: 'blutea', comName: 'Blue-winged Teal', sciName: 'Spatula discors' },
  { speciesCode: 'cintea', comName: 'Cinnamon Teal', sciName: 'Spatula cyanoptera' },
  { speciesCode: 'norsho', comName: 'Northern Shoveler', sciName: 'Spatula clypeata' },
  { speciesCode: 'gadwal', comName: 'Gadwall', sciName: 'Mareca strepera' },
  { speciesCode: 'canvas', comName: 'Canvasback', sciName: 'Aythya valisineria' },
  { speciesCode: 'rehead', comName: 'Redhead', sciName: 'Aythya americana' },
  { speciesCode: 'rinduc', comName: 'Ring-necked Duck', sciName: 'Aythya collaris' },
  { speciesCode: 'gresca', comName: 'Greater Scaup', sciName: 'Aythya marila' },
  { speciesCode: 'lessc', comName: 'Lesser Scaup', sciName: 'Aythya affinis' },
  { speciesCode: 'harldu', comName: 'Harlequin Duck', sciName: 'Histrionicus histrionicus' },
  { speciesCode: 'surfsco', comName: 'Surf Scoter', sciName: 'Melanitta perspicillata' },
  { speciesCode: 'whwsco2', comName: 'White-winged Scoter', sciName: 'Melanitta deglandi' },
  { speciesCode: 'blasc', comName: 'Black Scoter', sciName: 'Melanitta americana' },
  { speciesCode: 'longtai', comName: 'Long-tailed Duck', sciName: 'Clangula hyemalis' },
  { speciesCode: 'bufhea', comName: 'Bufflehead', sciName: 'Bucephala albeola' },
  { speciesCode: 'comgol', comName: 'Common Goldeneye', sciName: 'Bucephala clangula' },
  { speciesCode: 'bargol', comName: "Barrow's Goldeneye", sciName: 'Bucephala islandica' },
  { speciesCode: 'hoomer', comName: 'Hooded Merganser', sciName: 'Lophodytes cucullatus' },
  { speciesCode: 'commer', comName: 'Common Merganser', sciName: 'Mergus merganser' },
  { speciesCode: 'rebmer', comName: 'Red-breasted Merganser', sciName: 'Mergus serrator' },
  { speciesCode: 'ruddy', comName: 'Ruddy Duck', sciName: 'Oxyura jamaicensis' },
  // Raptors
  { speciesCode: 'osprey', comName: 'Osprey', sciName: 'Pandion haliaetus' },
  { speciesCode: 'baleag', comName: 'Bald Eagle', sciName: 'Haliaeetus leucocephalus' },
  { speciesCode: 'norhar2', comName: 'Northern Harrier', sciName: 'Circus hudsonius' },
  { speciesCode: 'shshaw', comName: 'Sharp-shinned Hawk', sciName: 'Accipiter striatus' },
  { speciesCode: 'coohaw', comName: "Cooper's Hawk", sciName: 'Accipiter cooperii' },
  { speciesCode: 'norgow', comName: 'Northern Goshawk', sciName: 'Accipiter atricapillus' },
  { speciesCode: 'swahaw', comName: "Swainson's Hawk", sciName: 'Buteo swainsoni' },
  { speciesCode: 'rethaw', comName: 'Red-tailed Hawk', sciName: 'Buteo jamaicensis' },
  { speciesCode: 'roshwk', comName: 'Rough-legged Hawk', sciName: 'Buteo lagopus' },
  { speciesCode: 'ferhaw', comName: 'Ferruginous Hawk', sciName: 'Buteo regalis' },
  { speciesCode: 'goldeag', comName: 'Golden Eagle', sciName: 'Aquila chrysaetos' },
  { speciesCode: 'ameke1', comName: 'American Kestrel', sciName: 'Falco sparverius' },
  { speciesCode: 'merlin', comName: 'Merlin', sciName: 'Falco columbarius' },
  { speciesCode: 'perfal', comName: 'Peregrine Falcon', sciName: 'Falco peregrinus' },
  { speciesCode: 'prfowl', comName: 'Prairie Falcon', sciName: 'Falco mexicanus' },
  // Owls
  { speciesCode: 'brnowl', comName: 'Barn Owl', sciName: 'Tyto alba' },
  { speciesCode: 'westwo', comName: 'Western Screech-Owl', sciName: 'Megascops kennicottii' },
  { speciesCode: 'grehoo', comName: 'Great Horned Owl', sciName: 'Bubo virginianus' },
  { speciesCode: 'snoowl', comName: 'Snowy Owl', sciName: 'Bubo scandiacus' },
  { speciesCode: 'barsow1', comName: 'Barred Owl', sciName: 'Strix varia' },
  { speciesCode: 'spowl1', comName: 'Spotted Owl', sciName: 'Strix occidentalis' },
  { speciesCode: 'shorow', comName: 'Short-eared Owl', sciName: 'Asio flammeus' },
  { speciesCode: 'norsaw', comName: 'Northern Saw-whet Owl', sciName: 'Aegolius acadicus' },
  // Shorebirds
  { speciesCode: 'killde', comName: 'Killdeer', sciName: 'Charadrius vociferus' },
  { speciesCode: 'blkbpl', comName: 'Black-bellied Plover', sciName: 'Pluvialis squatarola' },
  { speciesCode: 'greate1', comName: 'Greater Yellowlegs', sciName: 'Tringa melanoleuca' },
  { speciesCode: 'lesye', comName: 'Lesser Yellowlegs', sciName: 'Tringa flavipes' },
  { speciesCode: 'sposan', comName: 'Spotted Sandpiper', sciName: 'Actitis macularius' },
  { speciesCode: 'wilsni', comName: "Wilson's Snipe", sciName: 'Gallinago delicata' },
  { speciesCode: 'dunlin', comName: 'Dunlin', sciName: 'Calidris alpina' },
  { speciesCode: 'wessan', comName: 'Western Sandpiper', sciName: 'Calidris mauri' },
  { speciesCode: 'lessca', comName: 'Least Sandpiper', sciName: 'Calidris minutilla' },
  { speciesCode: 'blktur', comName: 'Black Turnstone', sciName: 'Arenaria melanocephala' },
  { speciesCode: 'ameavl', comName: 'American Avocet', sciName: 'Recurvirostra americana' },
  // Gulls & Terns
  { speciesCode: 'mewgul', comName: 'Mew Gull', sciName: 'Larus canus' },
  { speciesCode: 'ringgu', comName: 'Ring-billed Gull', sciName: 'Larus delawarensis' },
  { speciesCode: 'wester7', comName: 'Western Gull', sciName: 'Larus occidentalis' },
  { speciesCode: 'calgul', comName: 'California Gull', sciName: 'Larus californicus' },
  { speciesCode: 'hergu', comName: 'Herring Gull', sciName: 'Larus argentatus' },
  { speciesCode: 'glwgul', comName: 'Glaucous-winged Gull', sciName: 'Larus glaucescens' },
  { speciesCode: 'comter', comName: 'Common Tern', sciName: 'Sterna hirundo' },
  { speciesCode: 'arcte', comName: 'Arctic Tern', sciName: 'Sterna paradisaea' },
  { speciesCode: 'blatern', comName: 'Black Tern', sciName: 'Chlidonias niger' },
  // Pigeons & Doves
  { speciesCode: 'rocpig', comName: 'Rock Pigeon', sciName: 'Columba livia' },
  { speciesCode: 'bandta', comName: 'Band-tailed Pigeon', sciName: 'Patagioenas fasciata' },
  { speciesCode: 'eurcdo', comName: 'Eurasian Collared-Dove', sciName: 'Streptopelia decaocto' },
  { speciesCode: 'mourdo', comName: 'Mourning Dove', sciName: 'Zenaida macroura' },
  // Hummingbirds
  { speciesCode: 'annhum', comName: "Anna's Hummingbird", sciName: 'Calypte anna' },
  { speciesCode: 'rufhum', comName: 'Rufous Hummingbird', sciName: 'Selasphorus rufus' },
  { speciesCode: 'calhum', comName: 'Calliope Hummingbird', sciName: 'Selasphorus calliope' },
  // Woodpeckers
  { speciesCode: 'lewwoo', comName: "Lewis's Woodpecker", sciName: 'Melanerpes lewis' },
  { speciesCode: 'redsap', comName: 'Red-breasted Sapsucker', sciName: 'Sphyrapicus ruber' },
  { speciesCode: 'dowwoo', comName: 'Downy Woodpecker', sciName: 'Dryobates pubescens' },
  { speciesCode: 'haiwoo', comName: 'Hairy Woodpecker', sciName: 'Dryobates villosus' },
  { speciesCode: 'norflk1', comName: 'Northern Flicker', sciName: 'Colaptes auratus' },
  { speciesCode: 'pilwoo', comName: 'Pileated Woodpecker', sciName: 'Dryocopus pileatus' },
  // Flycatchers
  { speciesCode: 'olsspf', comName: 'Olive-sided Flycatcher', sciName: 'Contopus cooperi' },
  { speciesCode: 'weswoo1', comName: 'Western Wood-Pewee', sciName: 'Contopus sordidulus' },
  { speciesCode: 'pacifl', comName: 'Pacific-slope Flycatcher', sciName: 'Empidonax difficilis' },
  { speciesCode: 'dusfly', comName: 'Dusky Flycatcher', sciName: 'Empidonax oberholseri' },
  { speciesCode: 'westamp', comName: 'Western Kingbird', sciName: 'Tyrannus verticalis' },
  { speciesCode: 'easkin', comName: 'Eastern Kingbird', sciName: 'Tyrannus tyrannus' },
  // Shrikes
  { speciesCode: 'logsh', comName: 'Loggerhead Shrike', sciName: 'Lanius ludovicianus' },
  { speciesCode: 'norsh', comName: 'Northern Shrike', sciName: 'Lanius borealis' },
  // Vireos
  { speciesCode: 'casvir', comName: "Cassin's Vireo", sciName: 'Vireo cassinii' },
  { speciesCode: 'hutvir', comName: "Hutton's Vireo", sciName: 'Vireo huttoni' },
  { speciesCode: 'warvir', comName: 'Warbling Vireo', sciName: 'Vireo gilvus' },
  { speciesCode: 'rednvi', comName: 'Red-eyed Vireo', sciName: 'Vireo olivaceus' },
  // Corvids
  { speciesCode: 'stejay1', comName: "Steller's Jay", sciName: 'Cyanocitta stelleri' },
  { speciesCode: 'calsj', comName: 'California Scrub-Jay', sciName: 'Aphelocoma californica' },
  { speciesCode: 'canjas', comName: 'Canada Jay', sciName: 'Perisoreus canadensis' },
  { speciesCode: 'claknu', comName: "Clark's Nutcracker", sciName: 'Nucifraga columbiana' },
  { speciesCode: 'blkbma', comName: 'Black-billed Magpie', sciName: 'Pica hudsonia' },
  { speciesCode: 'amecro', comName: 'American Crow', sciName: 'Corvus brachyrhynchos' },
  { speciesCode: 'nwcrow1', comName: 'Northwestern Crow', sciName: 'Corvus caurinus' },
  { speciesCode: 'comrav', comName: 'Common Raven', sciName: 'Corvus corax' },
  // Larks & Swallows
  { speciesCode: 'horlar', comName: 'Horned Lark', sciName: 'Eremophila alpestris' },
  { speciesCode: 'purmar', comName: 'Purple Martin', sciName: 'Progne subis' },
  { speciesCode: 'treswa', comName: 'Tree Swallow', sciName: 'Tachycineta bicolor' },
  { speciesCode: 'vigswa', comName: 'Violet-green Swallow', sciName: 'Tachycineta thalassina' },
  { speciesCode: 'norrswa', comName: 'Northern Rough-winged Swallow', sciName: 'Stelgidopteryx serripennis' },
  { speciesCode: 'banswa', comName: 'Bank Swallow', sciName: 'Riparia riparia' },
  { speciesCode: 'cliswa', comName: 'Cliff Swallow', sciName: 'Petrochelidon pyrrhonota' },
  { speciesCode: 'barswa', comName: 'Barn Swallow', sciName: 'Hirundo rustica' },
  // Chickadees & Titmice
  { speciesCode: 'bkcchi', comName: 'Black-capped Chickadee', sciName: 'Poecile atricapillus' },
  { speciesCode: 'mouchi', comName: 'Mountain Chickadee', sciName: 'Poecile gambeli' },
  { speciesCode: 'chebch1', comName: 'Chestnut-backed Chickadee', sciName: 'Poecile rufescens' },
  // Nuthatches & Creepers
  { speciesCode: 'rebnut', comName: 'Red-breasted Nuthatch', sciName: 'Sitta canadensis' },
  { speciesCode: 'whbnut', comName: 'White-breasted Nuthatch', sciName: 'Sitta carolinensis' },
  { speciesCode: 'pygnut', comName: 'Pygmy Nuthatch', sciName: 'Sitta pygmaea' },
  { speciesCode: 'browcr', comName: 'Brown Creeper', sciName: 'Certhia americana' },
  // Wrens
  { speciesCode: 'rocwre', comName: 'Rock Wren', sciName: 'Salpinctes obsoletus' },
  { speciesCode: 'bewwre1', comName: "Bewick's Wren", sciName: 'Thryomanes bewickii' },
  { speciesCode: 'pacwre1', comName: 'Pacific Wren', sciName: 'Troglodytes pacificus' },
  { speciesCode: 'marwre', comName: 'Marsh Wren', sciName: 'Cistothorus palustris' },
  // Kinglets
  { speciesCode: 'gcrkin', comName: 'Golden-crowned Kinglet', sciName: 'Regulus satrapa' },
  { speciesCode: 'rucrki', comName: 'Ruby-crowned Kinglet', sciName: 'Corthylio calendula' },
  // Thrushes
  { speciesCode: 'wesblu', comName: 'Western Bluebird', sciName: 'Sialia mexicana' },
  { speciesCode: 'moublu', comName: 'Mountain Bluebird', sciName: 'Sialia currucoides' },
  { speciesCode: 'towsol', comName: "Townsend's Solitaire", sciName: 'Myadestes townsendi' },
  { speciesCode: 'swathr', comName: "Swainson's Thrush", sciName: 'Catharus ustulatus' },
  { speciesCode: 'hermth', comName: 'Hermit Thrush', sciName: 'Catharus guttatus' },
  { speciesCode: 'amerob', comName: 'American Robin', sciName: 'Turdus migratorius' },
  { speciesCode: 'varthr', comName: 'Varied Thrush', sciName: 'Ixoreus naevius' },
  // Waxwings & Starlings
  { speciesCode: 'eursta', comName: 'European Starling', sciName: 'Sturnus vulgaris' },
  { speciesCode: 'cedwax', comName: 'Cedar Waxwing', sciName: 'Bombycilla cedrorum' },
  // Warblers
  { speciesCode: 'orcwar', comName: 'Orange-crowned Warbler', sciName: 'Leiothlypis celata' },
  { speciesCode: 'comyel', comName: 'Common Yellowthroat', sciName: 'Geothlypis trichas' },
  { speciesCode: 'yelwar', comName: 'Yellow Warbler', sciName: 'Setophaga petechia' },
  { speciesCode: 'yewwar', comName: 'Yellow-rumped Warbler', sciName: 'Setophaga coronata' },
  { speciesCode: 'towwar', comName: "Townsend's Warbler", sciName: 'Setophaga townsendi' },
  { speciesCode: 'herwar', comName: 'Hermit Warbler', sciName: 'Setophaga occidentalis' },
  { speciesCode: 'macgwa1', comName: "MacGillivray's Warbler", sciName: 'Geothlypis tolmiei' },
  { speciesCode: 'wilwar', comName: "Wilson's Warbler", sciName: 'Cardellina pusilla' },
  // Sparrows & Towhees
  { speciesCode: 'chispa', comName: 'Chipping Sparrow', sciName: 'Spizella passerina' },
  { speciesCode: 'savspa', comName: 'Savannah Sparrow', sciName: 'Passerculus sandwichensis' },
  { speciesCode: 'foxspa', comName: 'Fox Sparrow', sciName: 'Passerella iliaca' },
  { speciesCode: 'sonspa', comName: 'Song Sparrow', sciName: 'Melospiza melodia' },
  { speciesCode: 'linspa', comName: "Lincoln's Sparrow", sciName: 'Melospiza lincolnii' },
  { speciesCode: 'golcsp', comName: 'Golden-crowned Sparrow', sciName: 'Zonotrichia atricapilla' },
  { speciesCode: 'whcspa', comName: 'White-crowned Sparrow', sciName: 'Zonotrichia leucophrys' },
  { speciesCode: 'daejun', comName: 'Dark-eyed Junco', sciName: 'Junco hyemalis' },
  { speciesCode: 'spotow', comName: 'Spotted Towhee', sciName: 'Pipilo maculatus' },
  // Blackbirds & Orioles
  { speciesCode: 'rewbla', comName: 'Red-winged Blackbird', sciName: 'Agelaius phoeniceus' },
  { speciesCode: 'wesmea', comName: 'Western Meadowlark', sciName: 'Sturnella neglecta' },
  { speciesCode: 'brwcow', comName: 'Brown-headed Cowbird', sciName: 'Molothrus ater' },
  { speciesCode: 'brwbla', comName: "Brewer's Blackbird", sciName: 'Euphagus cyanocephalus' },
  { speciesCode: 'bulori', comName: "Bullock's Oriole", sciName: 'Icterus bullockii' },
  // Finches
  { speciesCode: 'pinsis', comName: 'Pine Siskin', sciName: 'Spinus pinus' },
  { speciesCode: 'amegfi', comName: 'American Goldfinch', sciName: 'Spinus tristis' },
  { speciesCode: 'lesgol', comName: 'Lesser Goldfinch', sciName: 'Spinus psaltria' },
  { speciesCode: 'evegro', comName: 'Evening Grosbeak', sciName: 'Coccothraustes vespertinus' },
  { speciesCode: 'purfinc', comName: 'Purple Finch', sciName: 'Haemorhous purpureus' },
  { speciesCode: 'houfin', comName: 'House Finch', sciName: 'Haemorhous mexicanus' },
  { speciesCode: 'comredp', comName: 'Common Redpoll', sciName: 'Acanthis flammea' },
  { speciesCode: 'pingrb', comName: 'Pine Grosbeak', sciName: 'Pinicola enucleator' },
  { speciesCode: 'redcro', comName: 'Red Crossbill', sciName: 'Loxia curvirostra' },
  { speciesCode: 'whwcro', comName: 'White-winged Crossbill', sciName: 'Loxia leucoptera' },
  { speciesCode: 'houspa', comName: 'House Sparrow', sciName: 'Passer domesticus' },
  // Tanagers & Grosbeaks
  { speciesCode: 'westar', comName: 'Western Tanager', sciName: 'Piranga ludoviciana' },
  { speciesCode: 'blkhgr', comName: 'Black-headed Grosbeak', sciName: 'Pheucticus melanocephalus' },
  { speciesCode: 'lazbu', comName: 'Lazuli Bunting', sciName: 'Passerina amoena' },
];

export function searchSpecies(query: string): SpeciesEntry[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  return PNW_SPECIES.filter(
    (s) =>
      s.comName.toLowerCase().includes(q) ||
      s.sciName.toLowerCase().includes(q) ||
      s.speciesCode.toLowerCase().includes(q)
  ).slice(0, 20);
}
