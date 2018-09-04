<!-- list view -->
<div class="container-fluid" id="view-list">
	<div class="row">
		<div id="list-info-box">
			<!-- list-info-box.tpl -->
		</div>
		<div id="list-tools-box">
			<!-- list-tools-box.tpl -->
		</div>
		<div id="work-indicator">
			<img src="<?php echo $dataRootUri ?>/img/wait.gif" />
		</div>
		<div id="new-thread">
			<div id="new-thread-tools">
				<div class="btn-group">
					<a id="cancel-new-thread"
						class="btn btn-default glyphicon glyphicon-remove"
						title="Annuler le nouveau sujet"
						style="display: inline;">
					</a>
					<a id="send-new-thread"
						class="btn btn-default glyphicon glyphicon-envelope"
						title="Envoyer le nouveau sujet"
						style="display: inline;">
					</a>
				</div>
			</div>
			<input placeholder="Titre du nouveau sujet" type="text" id="new-thread-title" />
			<textarea id="new-thread-body" placeholder="Saisissez votre message ici"></textarea>
		</div>
		<div id="list-threads">
			<!-- list-threads.tpl -->
		</div>
		<div id="list-messages">
			<!-- list-messages.tpl -->
		</div>
	</div>
</div>

<!-- thread view -->
<div class="container-fluid" id="view-thread">
	<div class="row">
		<div id="back-to-list">
			<a title="Retour à la liste"
				class="back-to-list-link glyphicon glyphicon-circle-arrow-left"
				href="<?php echo $rootUri ?>/view-list">
			</a>
		</div>
		<div id="thread-info-box">
			<!-- thread-info-box.tpl -->
		</div>
		<div id="work-indicator">
			<img src="<?php echo $dataRootUri ?>/img/wait.gif" />
		</div>
		<div id="thread-messages">
			<!-- thread-messages.tpl -->
		</div>
	</div>
</div>




<?php
	// {{mustache}} templates
	include $templatesPath . '/list-info-box.tpl';
	include $templatesPath . '/list-tools-box.tpl';
	include $templatesPath . '/list-threads.tpl';
	include $templatesPath . '/list-messages.tpl';
?>

<script type="text/javascript">
	var forum = new EzmlmForum();
	forum.setConfig('<?= json_encode($config, JSON_HEX_APOS) ?>');
	forum.init();
</script>
