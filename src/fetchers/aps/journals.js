export const APS_JOURNALS = {
  prl: {
    code: "prl",
    displayName: "Physical Review Letters",
    baseUrl: "https://journals.aps.org/prl",
    rss: {
      accepted: "https://feeds.aps.org/rss/accepted/prl.xml",
      published: "https://feeds.aps.org/rss/recent/prl.xml"
    }
  },
  pra: {
    code: "pra",
    displayName: "Physical Review A",
    baseUrl: "https://journals.aps.org/pra",
    rss: {
      accepted: "https://feeds.aps.org/rss/accepted/pra.xml",
      published: "https://feeds.aps.org/rss/recent/pra.xml"
    }
  },
  prb: {
    code: "prb", displayName: "Physical Review B", baseUrl: "https://journals.aps.org/prb",
    rss: { accepted: "https://feeds.aps.org/rss/accepted/prb.xml", published: "https://feeds.aps.org/rss/recent/prb.xml" }
  },
  prd: {
    code: "prd", displayName: "Physical Review D", baseUrl: "https://journals.aps.org/prd",
    rss: { accepted: "https://feeds.aps.org/rss/accepted/prd.xml", published: "https://feeds.aps.org/rss/recent/prd.xml" }
  },
  pre: {
    code: "pre", displayName: "Physical Review E", baseUrl: "https://journals.aps.org/pre",
    rss: { accepted: "https://feeds.aps.org/rss/accepted/pre.xml", published: "https://feeds.aps.org/rss/recent/pre.xml" }
  },
  prx: {
    code: "prx",
    displayName: "Physical Review X",
    baseUrl: "https://journals.aps.org/prx",
    rss: {
      published: "https://feeds.aps.org/rss/recent/prx.xml"
    }
  },
  prxquantum: {
    code: "prxquantum",
    displayName: "PRX Quantum",
    baseUrl: "https://journals.aps.org/prxquantum",
    rss: {
      published: "https://feeds.aps.org/rss/recent/prxquantum.xml"
    }
  },
  prapplied: {
    code: "prapplied",
    displayName: "Physical Review Applied",
    baseUrl: "https://journals.aps.org/prapplied",
    rss: {
      accepted: "https://feeds.aps.org/rss/accepted/prapplied.xml",
      published: "https://feeds.aps.org/rss/recent/prapplied.xml"
    }
  },
  prresearch: {
    code: "prresearch",
    displayName: "Physical Review Research",
    baseUrl: "https://journals.aps.org/prresearch",
    rss: {
      published: "https://feeds.aps.org/rss/recent/prresearch.xml"
    }
  },
  prmaterials: {
    code: "prmaterials", displayName: "Physical Review Materials", baseUrl: "https://journals.aps.org/prmaterials",
    rss: { accepted: "https://feeds.aps.org/rss/accepted/prmaterials.xml", published: "https://feeds.aps.org/rss/recent/prmaterials.xml" }
  }
};

export function resolveApsJournals(journals) {
  const aliases = {
    prxquanum: "prxquantum"
  };

  if (journals === "all") {
    return Object.values(APS_JOURNALS);
  }

  return (journals || ["prl"])
    .map((journal) => APS_JOURNALS[aliases[journal] || journal])
    .filter(Boolean);
}
