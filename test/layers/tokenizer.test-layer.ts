import { Layer } from "effect"

import { Tokenizer } from "../../src/Tokenizer.js"
import type { TokenizerService } from "../../src/Tokenizer.js"

export const makeTokenizerTestLayer = (
  service: TokenizerService
): Layer.Layer<Tokenizer> =>
  Layer.succeed(Tokenizer, Tokenizer.make(service))

export const TokenizerContractTestLayer: Layer.Layer<Tokenizer> = Tokenizer.Default
