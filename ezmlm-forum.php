<?php
/**
 * Front controller for ezmlm-forum :
 * reads the config and renders the single page
 */
class EzmlmForum {

	const HREF_BUILD_MODE_REST = "REST";
	const HREF_BUILD_MODE_GET = "GET";

	/** JSON configuration */
	public $config = array();
	public static $CONFIG_PATH = "config/config.json";

	/** Resources (URI elements) */
	public $resources = array();

	/** Request parameters (GET or POST) */
	public $params = array();

	/** Domain root (to build URIs) */
	protected $domainRoot;

	/** Shall we build href links using REST-like URIs or GET parameters ? */
	protected $hrefBuildMode;

	/** Base URI (to parse resources) */
	protected $baseURI;

	/** Name of the auth adapter defined in the config file */
	protected $authAdapter;

	/** Data array to be injected into view template */
	protected $data = array();

	/** ezmlm hash of current thread */
	protected $threadHash;



	/**
	 * Starts the front controller, reads config, parameters and URI fragments
	 */
	public function __construct($config=null) {
		if ($config == null) {
			// read config
			if (! file_exists(self::$CONFIG_PATH)) {
				throw new Exception("please set a valid config file in [" . self::$CONFIG_PATH . "]");
			}
			$this->config = json_decode(file_get_contents(self::$CONFIG_PATH), true);
		} else {
			// external config
			$this->config = $config;
		}

		// server config
		$this->domainRoot = $this->config['domainRoot'];
		$this->baseURI = $this->config['baseUri'];
		$this->dataBaseURI = $this->baseURI;
		if (! empty($this->config['dataBaseUri'])) {
			$this->dataBaseURI = $this->config['dataBaseUri'];
		}

		// auth adapter config
		if (! empty($this->config['authAdapter'])) {
			$this->authAdapter = $this->config['authAdapter'];
		}

		// initialization
		$this->getHrefBuildMode();
		$this->getResources();
		$this->getParams();

		// read asked page
		$this->getAskedPage();

		// if needed by child classes
		$this->init();
	}

	/** Post-constructor adjustments */
	protected function init() {
		$this->getThreadHash();
	}

	/**
	 * Returns the base URI after the which JS, CSS etc. files may be invoked
	 */
	public function getRootUri() {
		return $this->domainRoot . $this->baseURI;
	}

	/**
	 * Returns the base URI for data : identical to getRootUri in the general
	 * case, but might be different when including the app in a container (for
	 * ex. Wordpress) whose URL are rewritten, and whose data have to be accessed
	 * using different URL (ex: /wp-content/...)
	 */
	public function getDataRootUri() {
		return $this->domainRoot . $this->dataBaseURI;
	}

	/**
	 * Returns the full path (including rootURI) of the auth adapter defined in
	 * the config file if any, or false
	 */
	public function getAuthAdapterPath() {
		$path = false;
		if ($this->authAdapter != null) {
			$path = $this->getRootUri() . '/js/auth/' . $this->authAdapter . '.js';
		}
		return $path;
	}

	/**
	 * Reads the desired href-links build mode (REST-like URIs or GET parameters)
	 * from the config, or defaults to HREF_BUILD_MODE_REST)
	 */
	protected function getHrefBuildMode() {
		$this->hrefBuildMode = self::HREF_BUILD_MODE_REST;
		if (
			!empty($this->config['hrefBuildMode'])
			&& in_array($this->config['hrefBuildMode'], array(self::HREF_BUILD_MODE_REST,self::HREF_BUILD_MODE_GET))
		) {
			$this->hrefBuildMode = $this->config['hrefBuildMode'];
		}
	}

	/**
	 * Compares request URI to base URI to extract URI elements (resources)
	 */
	protected function getResources() {
		$uri = $_SERVER['REQUEST_URI'];
		// slicing URI
		$baseURI = $this->baseURI . "/";
		if ((strlen($uri) > strlen($baseURI)) && (strpos($uri, $baseURI) !== false)) {
			$baseUriLength = strlen($baseURI);
			$posQM = strpos($uri, '?');
			if ($posQM != false) {
				$resourcesString = substr($uri, $baseUriLength, $posQM - $baseUriLength);
			} else {
				$resourcesString = substr($uri, $baseUriLength);
			}
			// decoding special characters
			$resourcesString = urldecode($resourcesString);
			//echo "Resources: $resourcesString" . PHP_EOL;
			$this->resources = explode("/", $resourcesString);
			// in case of a final /, gets rid of the last empty resource
			$nbRessources = count($this->resources);
			if (empty($this->resources[$nbRessources - 1])) {
				unset($this->resources[$nbRessources - 1]);
			}
		}
	}

	/**
	 * Gets the GET or POST request parameters
	 */
	protected function getParams() {
		$this->params = $_REQUEST;
	}

	/**
	 * Searches for parameter $name in $this->params; if defined (even if
	 * empty), returns its value; if undefined, returns $default
	 */
	public function getParam($name, $default=null) {
		if (isset($this->params[$name])) {
			return $this->params[$name];
		} else {
			return $default;
		}
	}

	/**
	 * Loads $this->page with the page asked : tries the 1st URI part after
	 * $this->rootUri; if it doesn't exist tries the "page" GET parameter;
	 * then tries $this->config['defaultPage']; finally returns "view-list" page
	 */
	protected function getAskedPage() {
		if (count($this->resources) > 0) {
			$this->page = $this->resources[0];
		} elseif ($this->getParam("page") != null) {
			$this->page = $this->getParam("page");
		} elseif (! empty($this->config['defaultPage'])) {
			$this->page = $this->config['defaultPage'];
		} else {
			$this->page = "view-list";
		}
	}

	/**
	 * Renders the page by injecting controller data inside a view template
	 */
	public function render() {
		$viewFile = 'views/ezmlm.php';
		if (! file_exists($viewFile)) {
			throw new Exception("view file [$viewFile] is missing");
		}
		// inject data and render template
		$this->buildPageData();
		extract($this->data);
		ob_start();
		if ((bool) ini_get('short_open_tag') === true) {
			include $viewFile;
		} else {
			$templateCode = file_get_contents($viewFile);
			$this->convertShortTags($templateCode);
			// Evaluating PHP mixed with HTML requires closing the PHP markup opened by eval()
			$templateCode = '?>' . $templateCode;
			echo eval($templateCode);
		}
		// get ouput
		$out = ob_get_contents();
		// get rid of buffer
		@ob_end_clean();

		echo $out;
	}

	protected function getThreadHash() {
		if (! empty($this->resources[1])) {
			$this->threadHash = $this->resources[1];
		} elseif ($this->getParam('thread') != null) {
			$this->threadHash = $this->getParam('thread');
		} // else no thread, we're viewing a list page
	}

	/**
	 * Returns an array of data to be injected in the view template; each key
	 * will lead to a variable named after it, ie. returning array('stuff' => 3)
	 * will make $stuff available in the template, with a value of 3
	 */
	protected function buildPageData() {
		$this->data ['config'] = $this->config;
		$this->data['threadHash'] = $this->threadHash; // TODO optional
		$this->data['dataRootUri'] = $this->getDataRootUri();
		$this->data['templatesPath'] = 'views/tpl';
	}

	/**
	 * Converts short PHP tags to <?php echo (...) ?> ones
	 */
	protected function convertShortTags(&$templateCode) {
		// Remplacement de tags courts par un tag long avec echo
		$templateCode = str_replace('<?=', '<?php echo ',  $templateCode);
		// Ajout systématique d'un point virgule avant la fermeture php
		$templateCode = preg_replace("/;*\s*\?>/", "; ?>", $templateCode);
	}

	/**
	 * Transforms a string to a CamelCase version, ex:
	 *   my-string => MyString
	 *   my_other--great.string => MyOtherGreatString
	 * @WARNING : does not manage strings that are already CamelCase thus fails, ex:
	 *   MyString => Mystring
	 *   a-BigBad_camelCase.string => ABigbadCamelcaseString
	 */
	protected function camelize($string) {
		$camelizedString = '';
		$pat = '/[A-Z-._]+/';
		$pieces = preg_split($pat, $string);
		foreach($pieces as $p) {
			$camelizedString .= ucfirst(strtolower($p));
		}
		return $camelizedString;
	}

	public function buildHrefLink($page, $params=array()) {
		throw new Exception('not implemented');
	}
}