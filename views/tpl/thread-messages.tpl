<script type="text/html" id="tpl-thread-messages" >
	{{#messages}}
		<h2>#{{message_id}} : {{subject}}</h2>
		<h3>by {{author_name}} on {{message_date}}</h3>
		{{{message_contents.text}}}
		<br/><br/>
	{{/messages}}
</script>