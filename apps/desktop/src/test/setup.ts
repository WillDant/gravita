import { configure } from "@testing-library/react";

// Lenses and the squad screens are lazy chunks. Importing one inside a test can take
// longer than findBy's default 1 s on a busy CI machine, so async queries wait up to 5 s.
configure({ asyncUtilTimeout: 5_000 });
